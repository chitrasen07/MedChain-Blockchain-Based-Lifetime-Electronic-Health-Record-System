const { Pool } = require("pg");
const crypto = require("node:crypto");
const { fieldHash, encryptJson, requiredKey, hashPassword, verifyPassword } = require("./crypto");

function createDb(config) {
  if (!config.databaseUrl) throw new Error("DATABASE_URL is required");
  const pool = new Pool({ connectionString: config.databaseUrl });
  const encryptionKey = requiredKey(config.piiEncryptionKey, "PII_ENCRYPTION_KEY", 32);
  const identityKey = Buffer.from(config.identityCommitmentKey, "utf8");
  const query = (text, values) => pool.query(text, values);
  const identityHashes = (profile) => Object.entries(profile).filter(([, value]) => value).map(([field, value]) => [field, fieldHash(identityKey, field, value)]);
  async function transaction(callback) {
    const client = await pool.connect();
    try { await client.query("BEGIN"); const result = await callback(client); await client.query("COMMIT"); return result; }
    catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }
  return {
    query,
    async checkReady() {
      await query("SELECT 1");
    },
    identityHashes,
    async authenticateUser(email, password) {
      const result = await query("SELECT id,email,password_hash,role,hospital_id,status FROM users WHERE email=$1", [email.toLowerCase()]);
      const user = result.rows[0];
      return user && user.status === "active" && verifyPassword(password, user.password_hash) ? user : null;
    },
    async getUserForAuth(id) {
      const result = await query(
        "SELECT id,role,hospital_id,status FROM users WHERE id=$1 AND status='active' AND EXISTS (SELECT 1 FROM hospitals h WHERE h.id=users.hospital_id AND h.status='active')",
        [id]
      );
      return result.rows[0] || null;
    },
    async countUsers() {
      const result = await query("SELECT count(*)::int AS count FROM users");
      return result.rows[0].count;
    },
    async createUser({ email, password, role, hospitalId }) {
      const result = await query(
        "INSERT INTO users (email,password_hash,role,hospital_id,status) SELECT $1,$2,$3,id,'active' FROM hospitals WHERE id=$4 AND status='active' RETURNING id,email,role,hospital_id,status",
        [email.toLowerCase(), hashPassword(password), role, hospitalId]
      );
      if (!result.rowCount) throw Object.assign(new Error("Hospital not found or disabled"), { statusCode: 404 });
      return result.rows[0];
    },
    async bootstrapAdmin({ email, password, hospitalId, hospitalName }) {
      return transaction(async (client) => {
        const existing = await client.query("SELECT 1 FROM users LIMIT 1");
        if (existing.rowCount) throw Object.assign(new Error("Bootstrap unavailable"), { statusCode: 403 });
        await client.query("INSERT INTO hospitals (id,name) VALUES ($1,$2)", [hospitalId, hospitalName]);
        const result = await client.query(
          "INSERT INTO users (email,password_hash,role,hospital_id,status) VALUES ($1,$2,'administrator',$3,'active') RETURNING id,email,role,hospital_id,status",
          [email.toLowerCase(), hashPassword(password), hospitalId]
        );
        return result.rows[0];
      });
    },
    async disableUser(userId, actorId, hospitalId) {
      const result = await query(
        "UPDATE users SET status='disabled' WHERE id=$1 AND hospital_id=$2 AND id<>$3 RETURNING id",
        [userId, hospitalId, actorId]
      );
      if (!result.rowCount) throw Object.assign(new Error("User not found"), { statusCode: 404 });
      await query("INSERT INTO audit_events (actor_id,action,resource_id,metadata) VALUES ($1,'USER_DISABLED',$2,$3)", [actorId, userId, JSON.stringify({ hospitalId })]);
    },
    async listUsers(hospitalId) {
      const result = await query(
        "SELECT id,email,role,status,created_at AS \"createdAt\" FROM users WHERE hospital_id=$1 ORDER BY created_at",
        [hospitalId]
      );
      return result.rows;
    },
    async createPendingPatient(profile, hashes, actorId, hospitalId, status = "pending") {
      return transaction(async (client) => {
        const requestId = crypto.randomUUID();
        const patient = await client.query(
          "INSERT INTO patients (pii_ciphertext,status,registration_request_id,hospital_id) VALUES ($1,$2,$3,$4) RETURNING id",
          [encryptJson(profile, encryptionKey), status, requestId, hospitalId]
        );
        for (const [field, hash] of hashes) await client.query("INSERT INTO patient_identity_hashes (patient_id,field_name,field_hash) VALUES ($1,$2,$3)", [patient.rows[0].id, field, hash]);
        await client.query("INSERT INTO audit_events (actor_id,action,resource_id) VALUES ($1,'PATIENT_REGISTRATION_PENDING',$2)", [actorId, patient.rows[0].id]);
        return { id: patient.rows[0].id };
      });
    },
    async getPendingRegistrationByCommitment(identityCommitment, hospitalId) {
      const result = await query(
        "SELECT r.patient_id AS id FROM registration_transactions r JOIN patients p ON p.id=r.patient_id WHERE r.identity_commitment=$1 AND r.hospital_id=$2 AND p.status='pending' ORDER BY r.updated_at DESC LIMIT 1",
        [identityCommitment, hospitalId]
      );
      return result.rows[0] || null;
    },
    async createReviewCase(profile, hashes, candidates, actorId, hospitalId) {
      return transaction(async (client) => {
        const requestFingerprint = crypto.createHash("sha256").update(JSON.stringify(hashes)).digest("hex");
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`review:${hospitalId}:${requestFingerprint}`]);
        const existing = await client.query(
          "SELECT id,case_status,new_patient_id AS \"newPatientId\" FROM review_cases WHERE hospital_id=$1 AND request_fingerprint=$2 AND case_status='pending' FOR UPDATE",
          [hospitalId, requestFingerprint]
        );
        if (existing.rowCount) return existing.rows[0];
        const requestId = crypto.randomUUID();
        const patient = await client.query(
          "INSERT INTO patients (pii_ciphertext,status,registration_request_id,hospital_id) VALUES ($1,'review',$2,$3) RETURNING id",
          [encryptJson(profile, encryptionKey), requestId, hospitalId]
        );
        for (const [field, hash] of hashes) {
          await client.query("INSERT INTO patient_identity_hashes (patient_id,field_name,field_hash) VALUES ($1,$2,$3)", [patient.rows[0].id, field, hash]);
        }
        const review = await client.query(
          "INSERT INTO review_cases (hospital_id,patient_id,new_patient_id,candidate_patient_ids,created_by,request_fingerprint) VALUES ($1,$2,$2,$3,$4,$5) RETURNING id,case_status,new_patient_id AS \"newPatientId\"",
          [hospitalId, patient.rows[0].id, candidates, actorId, requestFingerprint]
        );
        await client.query("INSERT INTO audit_events (actor_id,action,resource_id,metadata) VALUES ($1,'MATCH_REVIEW_CREATED',$2,$3)", [actorId, patient.rows[0].id, JSON.stringify({ hospitalId, candidateCount: candidates.length })]);
        return review.rows[0];
      });
    },
    async confirmPatient(id, chain, actorId, hospitalId) {
      const result = await query("UPDATE patients SET patient_id=$1,did=$2,blockchain_tx_hash=$3,status='confirmed',updated_at=now() WHERE id=$4 AND hospital_id=$5 AND status='pending' RETURNING patient_id,did,blockchain_tx_hash AS \"txHash\"", [chain.patientId, chain.did, chain.txHash, id, hospitalId]);
      if (!result.rowCount) throw new Error("Pending registration was not found");
      await query("INSERT INTO audit_events (actor_id,action,resource_id,metadata) VALUES ($1,'PATIENT_REGISTERED',$2,$3)", [actorId, id, JSON.stringify({ transaction: chain.txHash })]);
      return result.rows[0];
    },
    async beginRegistration(patientId, hospitalId, controller, identityCommitment) {
      return transaction(async (client) => {
        const existing = await client.query(
          "SELECT id,status,tx_hash AS \"txHash\",patient_id_on_chain AS \"patientId\",did_on_chain AS did,last_error AS \"lastError\" FROM registration_transactions WHERE patient_id=$1 AND hospital_id=$2 FOR UPDATE",
          [patientId, hospitalId]
        );
        if (existing.rowCount) {
          if (existing.rows[0].status === "unknown" || existing.rows[0].status === "failed") {
            const claimed = await client.query(
              "UPDATE registration_transactions SET status='submitting',updated_at=now() WHERE id=$1 RETURNING id,status,tx_hash AS \"txHash\"",
              [existing.rows[0].id]
            );
            return { ...claimed.rows[0], claimed: true };
          }
          return { ...existing.rows[0], claimed: false };
        }
        const result = await client.query(
          "INSERT INTO registration_transactions (patient_id,hospital_id,controller,identity_commitment,status) VALUES ($1,$2,$3,$4,'submitting') RETURNING id,status,tx_hash AS \"txHash\"",
          [patientId, hospitalId, controller, identityCommitment]
        );
        return { ...result.rows[0], claimed: true };
      });
    },
    async markRegistrationSubmitted(id, txHash) {
      const result = await query(
        "UPDATE registration_transactions SET status='submitted',tx_hash=$2,attempts=attempts+1,submitted_at=COALESCE(submitted_at,now()),updated_at=now() WHERE id=$1 AND status='submitting' RETURNING id",
        [id, txHash]
      );
      if (!result.rowCount) throw Object.assign(new Error("Registration attempt is no longer retryable"), { statusCode: 409 });
    },
    async markRegistrationResult(id, result) {
      const status = result.status === "confirmed" ? "confirmed" : result.status === "failed" ? "failed" : "unknown";
      const updated = await query(
        "UPDATE registration_transactions SET status=$2,tx_hash=COALESCE($3,tx_hash),patient_id_on_chain=$4,did_on_chain=$5,last_error=$6,confirmed_at=CASE WHEN $2='confirmed' THEN now() ELSE confirmed_at END,updated_at=now() WHERE id=$1 RETURNING patient_id,patient_id_on_chain AS \"chainPatientId\",did_on_chain AS \"chainDid\",tx_hash AS \"txHash\",status",
        [id, status, result.txHash || null, result.patientId || null, result.did || null, result.error || null]
      );
      return updated.rows[0];
    },
    async getRegistration(id, hospitalId) {
      const result = await query(
        "SELECT id,patient_id AS \"patientId\",status,tx_hash AS \"txHash\",patient_id_on_chain AS \"chainPatientId\",did_on_chain AS \"chainDid\",attempts,last_error AS \"lastError\" FROM registration_transactions WHERE id=$1 AND hospital_id=$2",
        [id, hospitalId]
      );
      return result.rows[0] || null;
    },
    async matchPatient(profile, hospitalId) {
      const hashes = identityHashes(profile);
      if (!hashes.length) return { status: "no_match", candidateCount: 0 };
      const values = [hospitalId, ...hashes.flat()];
      const pairs = hashes.map((_, i) => `($${i * 2 + 2},$${i * 2 + 3})`).join(",");
      const result = await query("SELECT p.id,p.patient_id,p.did,count(*)::int AS score FROM patients p JOIN patient_identity_hashes h ON h.patient_id=p.id WHERE p.hospital_id=$1 AND p.status='confirmed' AND (h.field_name,h.field_hash) IN (" + pairs + ") GROUP BY p.id,p.patient_id,p.did ORDER BY score DESC", values);
      if (!result.rows.length) return { status: "no_match", candidateCount: 0, candidates: [] };
      if (result.rows[0].score >= 3 && (result.rows.length === 1 || result.rows[0].score > result.rows[1].score)) return { status: "high_confidence", patient: result.rows[0], candidates: result.rows.map((row) => row.id) };
      return { status: "possible_match", candidateCount: result.rows.length, candidates: result.rows.map((row) => row.id) };
    },
    async getPatient(patientId, hospitalId) {
      const result = await query("SELECT patient_id AS \"patientId\",did,status,created_at AS \"createdAt\" FROM patients WHERE patient_id=$1 AND hospital_id=$2 AND status='confirmed'", [patientId, hospitalId]);
      return result.rows[0] || null;
    },
    async createVisit(patientId, input, actorId, hospitalId) {
      const result = await query("INSERT INTO visits (patient_id,record_reference,record_hash,created_by,hospital_id) SELECT id,$2,$3,$4,$5 FROM patients WHERE patient_id=$1 AND hospital_id=$5 AND status='confirmed' RETURNING id", [patientId, input.recordReference, input.recordHash || null, actorId, hospitalId]);
      if (!result.rowCount) { const error = new Error("Patient not found"); error.statusCode = 404; throw error; }
      return result.rows[0];
    },
    async listReviewCases(hospitalId) {
      const result = await query(
        "SELECT id,case_status AS status,created_at AS \"createdAt\",cardinality(candidate_patient_ids)::int AS \"candidateCount\" FROM review_cases WHERE hospital_id=$1 AND case_status='pending' ORDER BY created_at",
        [hospitalId]
      );
      return result.rows;
    },
    async getReviewCase(id, hospitalId) {
      const result = await query(
        "SELECT id,case_status AS status,created_at AS \"createdAt\",candidate_patient_ids AS \"candidateIds\",new_patient_id AS \"newPatientId\",linked_patient_id AS \"linkedPatientId\" FROM review_cases WHERE id=$1 AND hospital_id=$2",
        [id, hospitalId]
      );
      return result.rows[0] || null;
    },
    async resolveReviewCase(id, input, actorId, hospitalId) {
      return transaction(async (client) => {
        const current = await client.query("SELECT * FROM review_cases WHERE id=$1 AND hospital_id=$2 FOR UPDATE", [id, hospitalId]);
        if (!current.rowCount) throw Object.assign(new Error("Review case not found"), { statusCode: 404 });
        const review = current.rows[0];
        if (review.case_status !== "pending") {
          return { status: review.case_status, linkedPatientId: review.linked_patient_id, newPatientId: review.new_patient_id };
        }
        const status = input.decision === "same_patient" ? "resolved_same" : input.decision === "different_person" ? "resolved_different" : "rejected";
        const linkedPatientId = input.decision === "same_patient" ? input.candidatePatientId : null;
        if (input.decision === "same_patient" && !review.candidate_patient_ids.includes(linkedPatientId)) {
          throw Object.assign(new Error("Candidate is not part of this review"), { statusCode: 400 });
        }
        await client.query(
          "UPDATE review_cases SET case_status=$1,decision=$2,decision_notes=$3,decided_by=$4,decided_at=now(),linked_patient_id=$5 WHERE id=$6",
          [status, input.decision, input.notes || null, actorId, linkedPatientId, id]
        );
        if (input.decision === "same_patient") {
          await client.query("UPDATE patients SET status='linked',updated_at=now() WHERE id=$1", [review.new_patient_id]);
        } else if (input.decision === "different_person") {
          await client.query("UPDATE patients SET status='pending',updated_at=now() WHERE id=$1", [review.new_patient_id]);
        } else {
          await client.query("UPDATE patients SET status='linked',updated_at=now() WHERE id=$1", [review.new_patient_id]);
        }
        await client.query("INSERT INTO audit_events (actor_id,action,resource_id,metadata) VALUES ($1,'MATCH_REVIEW_RESOLVED',$2,$3)", [actorId, review.new_patient_id, JSON.stringify({ hospitalId, decision: input.decision })]);
        let publicPatientId = null;
        if (linkedPatientId) {
          const linked = await client.query("SELECT patient_id FROM patients WHERE id=$1", [linkedPatientId]);
          publicPatientId = linked.rows[0]?.patient_id || null;
        }
        return { status, linkedPatientId: publicPatientId, newPatientId: review.new_patient_id };
      });
    },
    async getReviewRegistration(reviewCaseId, hospitalId) {
      const result = await query(
        "SELECT p.id FROM review_cases rc JOIN patients p ON p.id=rc.new_patient_id WHERE rc.id=$1 AND rc.hospital_id=$2 AND rc.case_status='resolved_different' AND p.status='pending'",
        [reviewCaseId, hospitalId]
      );
      if (!result.rowCount) throw Object.assign(new Error("Registration review is not ready"), { statusCode: 409 });
      return result.rows[0];
    },
    async close() { await pool.end(); }
  };
}

module.exports = { createDb };
