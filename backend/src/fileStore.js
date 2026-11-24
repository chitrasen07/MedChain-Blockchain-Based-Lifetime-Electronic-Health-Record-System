const crypto = require("node:crypto");

const STORAGE_UNAVAILABLE = "Medical file storage is not configured.";

function unavailable() {
  return Object.assign(new Error(STORAGE_UNAVAILABLE), { statusCode: 503, code: "FILE_STORAGE_UNCONFIGURED" });
}

function createUnavailableFileStore() {
  return {
    configured: false,
    async put() { throw unavailable(); },
    async get() { throw unavailable(); },
    async delete() { throw unavailable(); }
  };
}

function createMemoryFileStore() {
  const objects = new Map();
  return {
    configured: true,
    objects,
    async put(key, body) {
      objects.set(key, Buffer.from(body));
    },
    async get(key) {
      const body = objects.get(key);
      if (!body) throw Object.assign(new Error("File not found"), { statusCode: 404, code: "NoSuchKey" });
      return Buffer.from(body);
    },
    async delete(key) {
      objects.delete(key);
    }
  };
}

function readFileStorage(env) {
  const source = env || {};
  const bucket = String(source.MEDICAL_FILE_S3_BUCKET || "").trim();
  const accessKeyId = String(source.MEDICAL_FILE_S3_ACCESS_KEY_ID || "").trim();
  const secretAccessKey = String(source.MEDICAL_FILE_S3_SECRET_ACCESS_KEY || "").trim();
  const endpoint = String(source.MEDICAL_FILE_S3_ENDPOINT || "").trim();
  const region = String(source.MEDICAL_FILE_S3_REGION || (endpoint ? "auto" : "us-east-1")).trim();
  if (!bucket && !accessKeyId && !secretAccessKey && !endpoint) return null;
  if (!bucket || !accessKeyId || !secretAccessKey) {
    throw new Error("Medical file storage requires the bucket, access key, and secret key together");
  }
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)) throw new Error("Medical file bucket name is invalid");
  if (endpoint) {
    const parsed = new URL(endpoint);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash) {
      throw new Error("Medical file storage endpoint must be an https origin");
    }
    if (parsed.pathname !== "/" && parsed.pathname !== "") throw new Error("Medical file storage endpoint must not include a path");
  }
  if (!/^[a-z0-9-]{2,32}$/.test(region)) throw new Error("Medical file storage region is invalid");
  return { bucket, accessKeyId, secretAccessKey, endpoint, region };
}

function createFileStore(env, fetchImpl) {
  const settings = readFileStorage(env);
  if (!settings) return createUnavailableFileStore();
  return createS3FileStore(settings, fetchImpl);
}

function amzDate(date) {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

function sha256(body) {
  return crypto.createHash("sha256").update(body).digest("hex");
}

function hmac(key, value) {
  return crypto.createHmac("sha256", key).update(value, "utf8").digest();
}

function signingKey(secret, dateStamp, region) {
  return hmac(hmac(hmac(hmac(`AWS4${secret}`, dateStamp), region), "s3"), "aws4_request");
}

function canonicalUri(bucket, key) {
  return `/${bucket}/${key.split("/").map((part) => encodeURIComponent(part)).join("/")}`;
}

async function signedRequest({ settings, method, key, body, fetchImpl, now }) {
  if (!/^(?:profile\/)?v1\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key)) {
    throw Object.assign(new Error("File not found"), { statusCode: 404 });
  }
  const payload = body ? Buffer.from(body) : Buffer.alloc(0);
  const stamp = amzDate(now || new Date());
  const date = stamp.slice(0, 8);
  const uri = canonicalUri(settings.bucket, key);
  const origin = settings.endpoint || `https://s3.${settings.region}.amazonaws.com`;
  const host = new URL(origin).host;
  const payloadHash = sha256(payload);
  const headerRows = [
    ["content-type", "application/octet-stream"],
    ["host", host],
    ["x-amz-content-sha256", payloadHash],
    ["x-amz-date", stamp]
  ];
  const canonicalHeaders = headerRows.map(([name, value]) => `${name}:${value}\n`).join("");
  const signedHeaders = headerRows.map(([name]) => name).join(";");
  const canonical = [method, uri, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const scope = `${date}/${settings.region}/s3/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", stamp, scope, sha256(canonical)].join("\n");
  const signature = crypto.createHmac("sha256", signingKey(settings.secretAccessKey, date, settings.region)).update(stringToSign).digest("hex");
  const response = await fetchImpl(`${origin}${uri}`, {
    method,
    redirect: "error",
    signal: AbortSignal.timeout(20_000),
    headers: {
      "content-type": "application/octet-stream",
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": stamp,
      authorization: `AWS4-HMAC-SHA256 Credential=${settings.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`
    },
    body: method === "GET" || method === "DELETE" ? undefined : payload
  });
  return response;
}

function createS3FileStore(settings, fetchImpl = globalThis.fetch) {
  return {
    configured: true,
    async put(key, body) {
      const response = await signedRequest({ settings, method: "PUT", key, body, fetchImpl });
      if (!response.ok) throw Object.assign(new Error("Medical file storage rejected the upload"), { statusCode: 503 });
    },
    async get(key) {
      const response = await signedRequest({ settings, method: "GET", key, fetchImpl });
      if (response.status === 404) throw Object.assign(new Error("File not found"), { statusCode: 404 });
      if (!response.ok) throw Object.assign(new Error("Medical file storage could not be read"), { statusCode: 503 });
      return Buffer.from(await response.arrayBuffer());
    },
    async delete(key) {
      const response = await signedRequest({ settings, method: "DELETE", key, fetchImpl });
      if (!response.ok && response.status !== 404) throw Object.assign(new Error("Medical file storage could not be cleaned up"), { statusCode: 503 });
    }
  };
}

module.exports = {
  STORAGE_UNAVAILABLE,
  createUnavailableFileStore,
  createMemoryFileStore,
  createFileStore,
  createS3FileStore,
  readFileStorage
};
