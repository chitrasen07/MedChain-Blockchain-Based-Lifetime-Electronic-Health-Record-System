const { Pool } = require("pg");
const crypto = require("node:crypto");
const { fieldHash, encryptJson, requiredKey, hashPassword, verifyPassword } = require("./crypto");

function poolConfig(connectionString) {
  const options = { connectionString };
  let mode = "";
  let host = "";
  try {
    const parsed = new URL(connectionString);
    mode = parsed.searchParams.get("sslmode") || "";
    host = parsed.hostname;
  } catch { mode = ""; }
  if (mode === "require" || mode === "verify-ca" || mode === "verify-full") {
    options.ssl = { rejectUnauthorized: true };
    if (host.endsWith(".neon.tech")) options.sslnegotiation = "direct";
  }
  return options;
}

function createDb(config) {
  if (!config.databaseUrl) throw new Error("DATABASE_URL is required");
  const pool = new Pool(poolConfig(config.databaseUrl));
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
    transaction,
    async checkReady() {
      await query("SELECT 1");
    },
    identityHashes,
    async authenticateUser(email, password) {
      const result = await query("SELECT id,email,password_hash,role,hospital_id,status,token_version,full_name FROM users WHERE email=$1", [email.toLowerCase()]);
      const user = result.rows[0];
      return user && user.status === "active" && verifyPassword(password, user.password_hash) ? user : null;
    },
    async findUserByEmail(email) {
      const result = await query(
        "SELECT id, role, hospital_id, status, full_name AS \"fullName\" FROM users WHERE email=$1",
        [String(email || "").toLowerCase()]
      );
      return result.rows[0] || null;
    },
    async recordActivity(event) {
      const resourceId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(event.resourceId || "") ? event.resourceId : null;
      let patientId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(event.patientId || "") ? event.patientId : null;
      if (!patientId && event.publicPatientId && event.hospitalId) {
        const found = await query("SELECT id FROM patients WHERE patient_id=$1 AND hospital_id=$2", [event.publicPatientId, event.hospitalId]);
        patientId = found.rows[0]?.id || null;
      }
      const viewActions = new Set(["record_viewed", "intake_viewed", "PATIENT_LOOKUP", "PROFILE_VIEWED", "VISIT_HISTORY_VIEWED"]);
      if (viewActions.has(event.action)) {
        const recent = await query(
          `SELECT 1 FROM audit_events
           WHERE action=$1 AND actor_id IS NOT DISTINCT FROM $2 AND actor_role IS NOT DISTINCT FROM $3
             AND patient_id IS NOT DISTINCT FROM $4 AND created_at > now() - interval '15 minutes'
           LIMIT 1`,
          [event.action, event.actorId || null, event.actorRole || null, patientId]
        );
        if (recent.rowCount) return { skipped: true };
      }
      if (resourceId && (event.action === "FILE_VIEWED" || event.action === "FILE_DOWNLOADED")) {
        const recentFile = await query(
          `SELECT 1 FROM audit_events
           WHERE action=$1 AND actor_id IS NOT DISTINCT FROM $2 AND actor_role IS NOT DISTINCT FROM $3
             AND resource_id=$4 AND created_at > now() - interval '2 minutes'
           LIMIT 1`,
          [event.action, event.actorId || null, event.actorRole || null, resourceId]
        );
        if (recentFile.rowCount) return { skipped: true };
      }
      const inserted = await query(
        `INSERT INTO audit_events (
           actor_id, actor_role, actor_label, hospital_id, patient_id, action, category, outcome, source, resource_id, request_id, tx_hash, metadata
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb)
         RETURNING id, created_at AS "createdAt"`,
        [
          event.actorId || null,
          event.actorRole || null,
          event.actorLabel || null,
          event.hospitalId || null,
          patientId,
          event.action,
          event.category || null,
          event.outcome || "success",
          event.source || "hospital",
          resourceId,
          event.requestId || null,
          event.txHash || null,
          JSON.stringify(event.metadata || {})
        ]
      );
      return inserted.rows[0];
    },
    async getUserForAuth(id) {
      const result = await query(
        "SELECT id,role,hospital_id,status,token_version FROM users WHERE id=$1 AND status='active' AND EXISTS (SELECT 1 FROM hospitals h WHERE h.id=users.hospital_id AND h.status='active')",
        [id]
      );
      return result.rows[0] || null;
    },
    async changePassword(userId, currentPassword, newPassword) {
      return transaction(async (client) => {
        const existing = await client.query(
          "SELECT password_hash FROM users WHERE id=$1 AND status='active'",
          [userId]
        );
        const row = existing.rows[0];
        if (!row || !verifyPassword(currentPassword, row.password_hash)) {
          throw Object.assign(new Error("The current password was not accepted."), { statusCode: 400 });
        }
        if (verifyPassword(newPassword, row.password_hash)) {
          throw Object.assign(new Error("Choose a password that is different from the current password."), { statusCode: 400 });
        }
        const updated = await client.query(
          "UPDATE users SET password_hash=$1, token_version=token_version+1 WHERE id=$2 AND status='active' AND password_hash=$3 RETURNING id",
          [hashPassword(newPassword), userId, row.password_hash]
        );
        if (!updated.rowCount) throw Object.assign(new Error("The current password was not accepted."), { statusCode: 400 });
        return { id: updated.rows[0].id };
      });
    },
    async countUsers() {
      const result = await query("SELECT count(*)::int AS count FROM users");
      return result.rows[0].count;
    },
    async createUser({ email, password, role, hospitalId, fullName, authorization }) {
      return transaction(async (client) => {
        const result = await client.query(
          "INSERT INTO users (email,password_hash,role,hospital_id,status,full_name) SELECT $1,$2,$3,id,'active',$5 FROM hospitals WHERE id=$4 AND status='active' RETURNING id,email,role,hospital_id,status,full_name AS \"fullName\"",
          [email.toLowerCase(), hashPassword(password), role, hospitalId, fullName]
        );
        if (!result.rowCount) throw Object.assign(new Error("Hospital not found or disabled"), { statusCode: 404 });
        const user = result.rows[0];
        if (authorization) {
          await client.query(
            "INSERT INTO staff_chain_authorizations (user_id,wallet_address,chain_role,status,action) VALUES ($1,$2,$3,'pending','grant')",
            [user.id, authorization.walletAddress, authorization.chainRole]
          );
          user.authorization = { status: "pending", action: "grant", walletAddress: authorization.walletAddress, chainRole: authorization.chainRole };
        }
        return user;
      });
    },
    async createStaffWalletChallenge({ walletAddress, nonce, message, expiresAt }) {
      await query(
        "INSERT INTO staff_wallet_challenges (nonce,wallet_address,message,expires_at) VALUES ($1,$2,$3,$4)",
        [nonce, walletAddress, message, expiresAt]
      );
    },
    async consumeStaffWalletChallenge(nonce) {
      const result = await query(
        "UPDATE staff_wallet_challenges SET used_at = now() WHERE nonce = $1 AND used_at IS NULL AND expires_at > now() RETURNING wallet_address AS \"walletAddress\", message",
        [nonce]
      );
      return result.rows[0] || null;
    },
    async updateStaffName(userId, hospitalId, fullName) {
      const result = await query(
        "UPDATE users SET full_name=$3 WHERE id=$1 AND hospital_id=$2 RETURNING id",
        [userId, hospitalId, fullName]
      );
      if (!result.rowCount) throw Object.assign(new Error("User not found"), { statusCode: 404 });
    },
    async getStaffMember(userId, hospitalId) {
      const result = await query(
        "SELECT u.id,u.email,u.full_name AS \"fullName\",u.role,u.status,a.wallet_address AS \"walletAddress\",a.chain_role AS \"chainRole\",a.previous_chain_role AS \"previousChainRole\",a.previous_wallet_address AS \"previousWalletAddress\",a.status AS \"authorizationStatus\",a.action AS \"authorizationAction\",a.tx_hash AS \"authorizationTx\" FROM users u LEFT JOIN staff_chain_authorizations a ON a.user_id=u.id WHERE u.id=$1 AND u.hospital_id=$2",
        [userId, hospitalId]
      );
      return result.rows[0] || null;
    },
    async saveStaffAuthorization({ userId, hospitalId, walletAddress, chainRole, previousChainRole, previousWalletAddress, action }) {
      const owner = await query("SELECT id,role FROM users WHERE id=$1 AND hospital_id=$2", [userId, hospitalId]);
      if (!owner.rowCount) throw Object.assign(new Error("User not found"), { statusCode: 404 });
      if (owner.rows[0].role === "administrator") throw Object.assign(new Error("This role cannot be granted on the blockchain."), { statusCode: 400 });
      await query(
        "INSERT INTO staff_chain_authorizations (user_id,wallet_address,chain_role,previous_chain_role,previous_wallet_address,status,action,tx_hash) VALUES ($1,$2,$3,$4,$5,'pending',$6,NULL) ON CONFLICT (user_id) DO UPDATE SET wallet_address=EXCLUDED.wallet_address,chain_role=EXCLUDED.chain_role,previous_chain_role=EXCLUDED.previous_chain_role,previous_wallet_address=EXCLUDED.previous_wallet_address,status='pending',action=EXCLUDED.action,tx_hash=NULL,updated_at=now()",
        [userId, walletAddress, chainRole, previousChainRole || null, previousWalletAddress || null, action]
      );
    },
    async markStaffAuthorization(userId, hospitalId, status, txHash) {
      const result = await query(
        "UPDATE staff_chain_authorizations AS staff_grant SET status=$3, tx_hash=COALESCE($4, staff_grant.tx_hash), updated_at=now() FROM users WHERE users.id=staff_grant.user_id AND users.id=$1 AND users.hospital_id=$2 RETURNING staff_grant.status",
        [userId, hospitalId, status, txHash || null]
      );
      if (!result.rowCount) throw Object.assign(new Error("User not found"), { statusCode: 404 });
    },
    async clearStaffAuthorization(userId, hospitalId) {
      await query(
        "DELETE FROM staff_chain_authorizations USING users WHERE staff_chain_authorizations.user_id=users.id AND users.id=$1 AND users.hospital_id=$2",
        [userId, hospitalId]
      );
    },
    async changeStaffRole({ userId, hospitalId, role, authorization }) {
      return transaction(async (client) => {
        const result = await client.query(
          "UPDATE users SET role=$3 WHERE id=$1 AND hospital_id=$2 AND role<>'administrator' RETURNING id,email,role,status,full_name AS \"fullName\"",
          [userId, hospitalId, role]
        );
        if (!result.rowCount) throw Object.assign(new Error("User not found"), { statusCode: 404 });
        if (authorization) {
          await client.query(
            "INSERT INTO staff_chain_authorizations (user_id,wallet_address,chain_role,previous_chain_role,previous_wallet_address,status,action) VALUES ($1,$2,$3,$4,$5,'pending',$6) ON CONFLICT (user_id) DO UPDATE SET wallet_address=EXCLUDED.wallet_address,chain_role=EXCLUDED.chain_role,previous_chain_role=EXCLUDED.previous_chain_role,previous_wallet_address=EXCLUDED.previous_wallet_address,status='pending',action=EXCLUDED.action,tx_hash=NULL,updated_at=now()",
            [userId, authorization.walletAddress, authorization.chainRole, authorization.previousChainRole || null, authorization.previousWalletAddress || null, authorization.action]
          );
        }
        return result.rows[0];
      });
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
      await query(
        "UPDATE staff_chain_authorizations SET action='revoke', status='pending', updated_at=now() WHERE user_id=$1",
        [userId]
      );
      await query("INSERT INTO audit_events (actor_id,action,resource_id,metadata) VALUES ($1,'USER_DISABLED',$2,$3)", [actorId, userId, JSON.stringify({ hospitalId })]);
    },
    async listConsentDoctors(hospitalId) {
      const result = await query(
        "SELECT u.full_name AS \"fullName\", a.wallet_address AS \"walletAddress\" FROM users u JOIN staff_chain_authorizations a ON a.user_id=u.id WHERE u.hospital_id=$1 AND u.role='doctor' AND u.status='active' AND a.status='active' AND a.action='grant' AND a.chain_role='DOCTOR' AND a.wallet_address IS NOT NULL ORDER BY u.full_name NULLS LAST, u.created_at",
        [hospitalId]
      );
      return result.rows;
    },
    async listUsers(hospitalId) {
      const result = await query(
        "SELECT u.id,u.email,u.full_name AS \"fullName\",u.role,u.status,u.created_at AS \"createdAt\",a.wallet_address AS \"walletAddress\",a.chain_role AS \"chainRole\",a.previous_chain_role AS \"previousChainRole\",a.previous_wallet_address AS \"previousWalletAddress\",a.status AS \"authorizationStatus\",a.action AS \"authorizationAction\",a.tx_hash AS \"authorizationTx\" FROM users u LEFT JOIN staff_chain_authorizations a ON a.user_id=u.id WHERE u.hospital_id=$1 ORDER BY u.created_at",
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
    async findRegistrationByCommitment(identityCommitment, hospitalId) {
      const result = await query(
        "SELECT r.status, r.tx_hash AS \"txHash\", r.last_error AS \"lastError\", r.patient_id AS \"patientId\", p.patient_id AS \"publicId\", r.did_on_chain AS did FROM registration_transactions r JOIN patients p ON p.id=r.patient_id WHERE r.identity_commitment=$1 AND r.hospital_id=$2 ORDER BY r.updated_at DESC LIMIT 1",
        [identityCommitment, hospitalId]
      );
      return result.rows[0] || null;
    },
    async closeRejectedRegistration(patientId, hospitalId) {
      await query(
        "UPDATE patients SET status='registration_failed', updated_at=now() WHERE id=$1 AND hospital_id=$2 AND status='pending'",
        [patientId, hospitalId]
      );
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
    async addReviewCandidates(reviewCaseId, hospitalId, candidateIds) {
      const result = await query(
        "UPDATE review_cases SET candidate_patient_ids = (SELECT ARRAY(SELECT DISTINCT id FROM unnest(candidate_patient_ids || $3::uuid[]) AS id)) WHERE id=$1 AND hospital_id=$2 AND case_status='pending' RETURNING id",
        [reviewCaseId, hospitalId, candidateIds]
      );
      return result.rows[0] || null;
    },
    async assessReviewAuthorization({ hospitalId, hashes, reviewCaseId = null, candidateIds = [], highConfidenceId = "" }) {
      const fingerprint = crypto.createHash("sha256").update(JSON.stringify(hashes)).digest("hex");
      const reviews = await loadReviewAuthorizations(query, hospitalId, { reviewCaseId, fingerprint });
      if (!reviews.length) return reviewCaseId ? { action: "not_found" } : { action: "create" };
      const options = { candidateIds, highConfidenceId };
      if (reviewCaseId) {
        const review = reviews[0];
        if (review.request_fingerprint !== fingerprint) return { action: "mismatch" };
        if (!(await sameIdentityHashes(query, review.newPatientId, hashes))) return { action: "mismatch" };
        return classifyReview(review, options);
      }
      for (const review of reviews) {
        if (!(await sameIdentityHashes(query, review.newPatientId, hashes))) continue;
        const decision = classifyReview(review, options);
        if (decision.action === "authorized") return decision;
      }
      const pending = reviews.find((review) => review.case_status === "pending");
      return classifyReview(pending || reviews[0], options);
    },
    async confirmPatient(id, chain, actorId, hospitalId) {
      return transaction(async (client) => {
        let publicId = chain.patientId;
        if (chain.allocatePublicId) {
          await client.query("SELECT pg_advisory_xact_lock(hashtext('medchain-patient-public-id'))");
          const next = await client.query("SELECT COALESCE(MAX(CAST(SUBSTRING(patient_id FROM 9) AS INTEGER)), 0) + 1 AS n FROM patients WHERE patient_id ~ '^PATIENT-[0-9]+$'");
          publicId = `PATIENT-${String(next.rows[0].n).padStart(6, "0")}`;
        }
        const chainRef = chain.patientRef || chain.did || null;
        const controller = chain.controller && !String(chain.controller).startsWith("unclaimed") ? chain.controller : null;
        const result = await client.query(
          "UPDATE patients SET patient_id=$1,did=$2,controller=$3,blockchain_tx_hash=$4,status='confirmed',updated_at=now() WHERE id=$5 AND hospital_id=$6 AND status='pending' RETURNING patient_id,did,blockchain_tx_hash AS \"txHash\"",
          [publicId, chainRef, controller, chain.txHash, id, hospitalId]
        );
        if (!result.rowCount) throw new Error("Pending registration was not found");
        await client.query("INSERT INTO audit_events (actor_id,action,resource_id,metadata) VALUES ($1,'PATIENT_REGISTERED',$2,$3)", [actorId, id, JSON.stringify({ transaction: chain.txHash })]);
        return { patientId: result.rows[0].patient_id, did: result.rows[0].did, txHash: result.rows[0].txHash };
      });
    },
    async beginRegistration(patientId, hospitalId, controller, identityCommitment) {
      return transaction(async (client) => {
        const existing = await client.query(
          "SELECT id,status,tx_hash AS \"txHash\",patient_id_on_chain AS \"patientId\",did_on_chain AS did,controller,last_error AS \"lastError\" FROM registration_transactions WHERE patient_id=$1 AND hospital_id=$2 FOR UPDATE",
          [patientId, hospitalId]
        );
        if (existing.rowCount) {
          const current = existing.rows[0];
          if (current.status === "failed" && !current.txHash && current.lastError === "duplicate identity commitment") {
            return { ...current, claimed: false, duplicateConflict: true };
          }
          if (current.status === "unknown" || current.status === "failed") {
            const claimed = await client.query(
              "UPDATE registration_transactions SET status='submitting',updated_at=now() WHERE id=$1 RETURNING id,status,tx_hash AS \"txHash\",controller",
              [existing.rows[0].id]
            );
            return { ...claimed.rows[0], claimed: true };
          }
          return { ...existing.rows[0], claimed: false };
        }
        await client.query("SAVEPOINT registration_claim");
        try {
          const result = await client.query(
            "INSERT INTO registration_transactions (patient_id,hospital_id,controller,identity_commitment,status) VALUES ($1,$2,$3,$4,'submitting') RETURNING id,status,tx_hash AS \"txHash\"",
            [patientId, hospitalId, controller, identityCommitment]
          );
          await client.query("RELEASE SAVEPOINT registration_claim");
          return { ...result.rows[0], claimed: true };
        } catch (error) {
          await client.query("ROLLBACK TO SAVEPOINT registration_claim");
          if (error.code !== "23505") throw error;
          const raced = await client.query(
            "SELECT id,status,tx_hash AS \"txHash\",patient_id_on_chain AS \"patientId\",did_on_chain AS did,controller,last_error AS \"lastError\" FROM registration_transactions WHERE patient_id=$1 AND hospital_id=$2 FOR UPDATE",
            [patientId, hospitalId]
          );
          if (!raced.rowCount) throw error;
          return { ...raced.rows[0], claimed: false };
        }
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
      const hashes = identifyingHashes(identityHashes(profile));
      if (!hashes.length) return { status: "no_match", candidateCount: 0, candidates: [] };
      const values = [hospitalId, ...hashes.flat()];
      const pairs = hashes.map((_, index) => `($${index * 2 + 2},$${index * 2 + 3})`).join(",");
      const result = await query(
        `SELECT p.id, p.patient_id, p.did, h.field_name AS "fieldName" FROM patients p JOIN patient_identity_hashes h ON h.patient_id=p.id WHERE p.hospital_id=$1 AND p.status='confirmed' AND (h.field_name,h.field_hash) IN (${pairs})`,
        values
      );
      return decidePatientMatch(result.rows);
    },
    async getPatient(patientId, hospitalId) {
      const result = await query("SELECT patient_id AS \"patientId\",did,status,created_at AS \"createdAt\" FROM patients WHERE patient_id=$1 AND hospital_id=$2 AND status='confirmed'", [patientId, hospitalId]);
      return result.rows[0] || null;
    },
    async getPatientChartSource(patientId, hospitalId) {
      const result = await query(
        "SELECT id, patient_id AS \"patientId\", did, hospital_id, status, pii_ciphertext AS \"piiCiphertext\", created_at AS \"createdAt\" FROM patients WHERE patient_id=$1 AND hospital_id=$2 AND status='confirmed'",
        [patientId, hospitalId]
      );
      return result.rows[0] || null;
    },
    async getStaffName(id) {
      const result = await query("SELECT full_name FROM users WHERE id=$1", [id]);
      const name = String(result.rows[0]?.full_name || "").trim();
      return name ? name.slice(0, 120) : null;
    },
    async createMedicalFile(input) {
      const result = await query(
        `INSERT INTO medical_files (
           hospital_id, patient_id, uploader_user_id, uploader_role, uploader_label,
           category, filename_ciphertext, description_ciphertext, storage_key,
           content_type, byte_size, sha256
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         RETURNING id, created_at AS "createdAt"`,
        [
          input.hospitalId,
          input.patientId,
          input.uploaderUserId,
          input.uploaderRole,
          input.uploaderLabel,
          input.category,
          input.filenameCiphertext,
          input.descriptionCiphertext,
          input.storageKey,
          input.contentType,
          input.byteSize,
          input.sha256
        ]
      );
      return result.rows[0];
    },
    async listMedicalFiles(patientId, hospitalId) {
      const result = await query(
        `SELECT id, category, filename_ciphertext AS "filenameCiphertext",
                description_ciphertext AS "descriptionCiphertext",
                content_type AS "contentType", byte_size AS "byteSize",
                uploader_role AS "uploaderRole", uploader_label AS "uploaderLabel",
                created_at AS "createdAt"
         FROM medical_files
         WHERE patient_id=$1 AND hospital_id=$2
         ORDER BY created_at DESC
         LIMIT 100`,
        [patientId, hospitalId]
      );
      return result.rows;
    },
    async getMedicalFile(id, patientId, hospitalId) {
      const result = await query(
        `SELECT id, category, filename_ciphertext AS "filenameCiphertext",
                description_ciphertext AS "descriptionCiphertext",
                storage_key AS "storageKey", content_type AS "contentType",
                byte_size AS "byteSize", sha256, uploader_role AS "uploaderRole",
                uploader_label AS "uploaderLabel", created_at AS "createdAt"
         FROM medical_files
         WHERE id=$1 AND patient_id=$2 AND hospital_id=$3`,
        [id, patientId, hospitalId]
      );
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
        "SELECT p.id, p.status AS \"patientStatus\", rc.case_status AS \"caseStatus\" FROM review_cases rc JOIN patients p ON p.id=rc.new_patient_id WHERE rc.id=$1 AND rc.hospital_id=$2",
        [reviewCaseId, hospitalId]
      );
      const row = result.rows[0];
      if (row?.caseStatus === "resolved_different" && row.patientStatus === "pending") return { id: row.id };
      if (row?.caseStatus === "resolved_different") {
        throw Object.assign(new Error("This review case has already been used for a registration."), { statusCode: 409 });
      }
      throw Object.assign(new Error("Registration review is not ready"), { statusCode: 409 });
    },
    async findConfirmedPatientForAuth(publicId) {
      const result = await query(
        "SELECT p.id, p.patient_id AS \"patientId\", p.did, p.hospital_id, p.status, r.controller AS \"registrationController\" FROM patients p LEFT JOIN registration_transactions r ON r.patient_id = p.id WHERE p.patient_id = $1 AND p.status = 'confirmed'",
        [publicId]
      );
      return result.rows[0] || null;
    },
    async getPatientForAuth(id) {
      const result = await query(
        "SELECT id, patient_id AS \"patientId\", did, status, hospital_id, blockchain_tx_hash AS \"txHash\", pii_ciphertext AS \"piiCiphertext\", created_at AS \"createdAt\" FROM patients WHERE id = $1 AND status = 'confirmed'",
        [id]
      );
      return result.rows[0] || null;
    },
    async createRegistrationWalletChallenge({ walletAddress, nonce, message, expiresAt }) {
      await query(
        "INSERT INTO registration_wallet_challenges (nonce, wallet_address, message, expires_at) VALUES ($1,$2,$3,$4)",
        [nonce, walletAddress, message, expiresAt]
      );
    },
    async consumeRegistrationWalletChallenge(nonce) {
      const result = await query(
        "UPDATE registration_wallet_challenges SET used_at = now() WHERE nonce = $1 AND used_at IS NULL AND expires_at > now() RETURNING wallet_address AS \"walletAddress\", message",
        [nonce]
      );
      return result.rows[0] || null;
    },
    async createPatientChallenge({ patientId, walletAddress, nonce, message, expiresAt }) {
      await query(
        "INSERT INTO patient_auth_challenges (patient_id, wallet_address, nonce, message, expires_at) VALUES ($1,$2,$3,$4,$5)",
        [patientId, walletAddress, nonce, message, expiresAt]
      );
    },
    async consumePatientChallenge(nonce) {
      const result = await query(
        "UPDATE patient_auth_challenges AS challenge SET used_at = now() FROM patients WHERE challenge.nonce = $1 AND challenge.used_at IS NULL AND challenge.expires_at > now() AND patients.id = challenge.patient_id AND patients.status = 'confirmed' RETURNING challenge.patient_id AS \"patientId\", challenge.wallet_address AS \"walletAddress\", challenge.message, patients.patient_id AS \"publicPatientId\"",
        [nonce]
      );
      return result.rows[0] || null;
    },
    async createMedicalRecord(input) {
      const result = await query(
        "INSERT INTO medical_records (patient_id,hospital_id,category,version_index,prior_record_id,record_ref,content_ciphertext,content_hash,recorded_on,chain_status,created_by,correction_reason_ciphertext,workflow_status) SELECT id,$2,$3,$4,$5,$6,$7,$8,$9,'consent_required',$10,$11,$12 FROM patients WHERE patient_id=$1 AND hospital_id=$2 AND status='confirmed' RETURNING id,category,version_index AS \"versionIndex\",prior_record_id AS \"priorRecordId\",record_ref AS \"recordRef\",content_hash AS \"contentHash\",recorded_on AS \"recordedOn\",chain_status AS \"chainStatus\",workflow_status AS \"workflowStatus\",tx_hash AS \"txHash\"",
        [input.publicPatientId, input.hospitalId, input.category, input.versionIndex, input.priorRecordId, input.recordRef, input.contentCiphertext, input.contentHash, input.recordedOn, input.actorId, input.correctionReasonCiphertext || null, input.workflowStatus || "reviewed"]
      );
      if (!result.rowCount) {
        const error = new Error("Patient not found");
        error.statusCode = 404;
        throw error;
      }
      return result.rows[0];
    },
    async markMedicalRecordChain({ id, hospitalId, txHash, chainStatus }) {
      const result = await query(
        "UPDATE medical_records SET tx_hash=$3, chain_status=$4 WHERE id=$1 AND hospital_id=$2 AND (tx_hash IS NULL OR lower(tx_hash)=lower($3)) RETURNING id, chain_status AS \"chainStatus\", tx_hash AS \"txHash\"",
        [id, hospitalId, txHash, chainStatus]
      );
      return result.rows[0] || null;
    },
    async getMedicalRecord(id, hospitalId) {
      const result = await query(
        "SELECT m.id,m.category,m.version_index AS \"versionIndex\",m.prior_record_id AS \"priorRecordId\",m.record_ref AS \"recordRef\",m.content_ciphertext AS \"contentCiphertext\",m.content_hash AS \"contentHash\",m.recorded_on AS \"recordedOn\",m.chain_status AS \"chainStatus\",m.workflow_status AS \"workflowStatus\",m.correction_reason_ciphertext AS \"correctionReasonCiphertext\",m.tx_hash AS \"txHash\",p.patient_id AS \"publicPatientId\" FROM medical_records m JOIN patients p ON p.id=m.patient_id WHERE m.id=$1 AND m.hospital_id=$2",
        [id, hospitalId]
      );
      return result.rows[0] || null;
    },
    async listMedicalRecordsByPublicId(publicPatientId, hospitalId) {
      const result = await query(
        "SELECT m.id,m.category,m.version_index AS \"versionIndex\",m.prior_record_id AS \"priorRecordId\",m.record_ref AS \"recordRef\",m.content_ciphertext AS \"contentCiphertext\",m.content_hash AS \"contentHash\",m.recorded_on AS \"recordedOn\",m.chain_status AS \"chainStatus\",m.workflow_status AS \"workflowStatus\",m.correction_reason_ciphertext AS \"correctionReasonCiphertext\",m.tx_hash AS \"txHash\",m.created_at AS \"createdAt\",u.full_name AS \"authorName\" FROM medical_records m JOIN patients p ON p.id=m.patient_id LEFT JOIN users u ON u.id=m.created_by WHERE p.patient_id=$1 AND m.hospital_id=$2 AND p.status='confirmed' ORDER BY m.recorded_on ASC, m.created_at ASC, m.version_index ASC",
        [publicPatientId, hospitalId]
      );
      return result.rows;
    },
    async listMedicalRecordsForPatient(patientId) {
      const result = await query(
        "SELECT m.id,m.category,m.version_index AS \"versionIndex\",m.prior_record_id AS \"priorRecordId\",m.record_ref AS \"recordRef\",m.content_ciphertext AS \"contentCiphertext\",m.content_hash AS \"contentHash\",m.recorded_on AS \"recordedOn\",m.chain_status AS \"chainStatus\",m.workflow_status AS \"workflowStatus\",m.correction_reason_ciphertext AS \"correctionReasonCiphertext\",m.tx_hash AS \"txHash\",m.created_at AS \"createdAt\",u.full_name AS \"authorName\" FROM medical_records m LEFT JOIN users u ON u.id=m.created_by WHERE m.patient_id=$1 ORDER BY m.recorded_on ASC, m.created_at ASC, m.version_index ASC",
        [patientId]
      );
      return result.rows;
    },
    async createClinicalChallenge({ userId, walletAddress, nonce, message, expiresAt }) {
      await query(
        "INSERT INTO clinical_wallet_challenges (user_id, wallet_address, nonce, message, expires_at) VALUES ($1,$2,$3,$4,$5)",
        [userId, walletAddress, nonce, message, expiresAt]
      );
    },
    async consumeClinicalChallenge(nonce) {
      const result = await query(
        "UPDATE clinical_wallet_challenges SET used_at = now() WHERE nonce = $1 AND used_at IS NULL AND expires_at > now() RETURNING user_id AS \"userId\", wallet_address AS \"walletAddress\", message",
        [nonce]
      );
      return result.rows[0] || null;
    },
    async saveClinicalWallet({ userId, walletAddress, expiresAt }) {
      await query(
        "INSERT INTO clinical_wallet_sessions (user_id, wallet_address, expires_at) VALUES ($1,$2,$3) ON CONFLICT (user_id) DO UPDATE SET wallet_address = EXCLUDED.wallet_address, expires_at = EXCLUDED.expires_at",
        [userId, walletAddress, expiresAt]
      );
    },
    async getClinicalWallet(userId) {
      const result = await query(
        "SELECT wallet_address AS \"walletAddress\" FROM clinical_wallet_sessions WHERE user_id = $1 AND expires_at > now()",
        [userId]
      );
      return result.rows[0]?.walletAddress || null;
    },
    async createAccessAudit(input) {
      const result = await query(
        "INSERT INTO access_audit_events (hospital_id, patient_id, patient_ref, actor_wallet, action_code, reason_ciphertext, reason_hash, tx_hash, expires_at) SELECT $1, id, $3, $4, $5, $6, $7, $8, $9 FROM patients WHERE patient_id = $2 AND hospital_id = $1 AND status = 'confirmed' RETURNING id",
        [input.hospitalId, input.publicPatientId, input.patientRef, input.actorWallet, input.actionCode, input.reasonCiphertext, input.reasonHash, input.txHash, input.expiresAt]
      );
      if (!result.rowCount) {
        const error = new Error("Patient not found");
        error.statusCode = 404;
        throw error;
      }
      return result.rows[0];
    },
    async listAccessAuditForPatient(patientId) {
      const result = await query(
        "SELECT actor_wallet AS \"actorWallet\", action_code AS \"actionCode\", reason_ciphertext AS \"reasonCiphertext\", reason_hash AS \"reasonHash\", tx_hash AS \"txHash\", expires_at AS \"expiresAt\", created_at AS \"createdAt\" FROM access_audit_events WHERE patient_id = $1 ORDER BY created_at ASC",
        [patientId]
      );
      return result.rows;
    },
    async listAccessAuditForHospital(publicPatientId, hospitalId) {
      const result = await query(
        "SELECT e.actor_wallet AS \"actorWallet\", e.action_code AS \"actionCode\", e.reason_ciphertext AS \"reasonCiphertext\", e.reason_hash AS \"reasonHash\", e.tx_hash AS \"txHash\", e.expires_at AS \"expiresAt\", e.created_at AS \"createdAt\" FROM access_audit_events e JOIN patients p ON p.id = e.patient_id WHERE p.patient_id = $1 AND e.hospital_id = $2 ORDER BY e.created_at ASC",
        [publicPatientId, hospitalId]
      );
      return result.rows;
    },
    async createProfileNote({ publicPatientId, hospitalId, contentCiphertext, actorId }) {
      const result = await query(
        "INSERT INTO patient_profile_notes (patient_id, hospital_id, content_ciphertext, created_by) SELECT id, $2, $3, $4 FROM patients WHERE patient_id=$1 AND hospital_id=$2 AND status='confirmed' RETURNING id",
        [publicPatientId, hospitalId, contentCiphertext, actorId]
      );
      if (!result.rowCount) {
        const error = new Error("Patient not found");
        error.statusCode = 404;
        throw error;
      }
      return result.rows[0];
    },
    async listProfileNotes(publicPatientId, hospitalId) {
      const result = await query(
        "SELECT n.content_ciphertext AS \"contentCiphertext\", n.created_at AS \"createdAt\" FROM patient_profile_notes n JOIN patients p ON p.id=n.patient_id WHERE p.patient_id=$1 AND n.hospital_id=$2 ORDER BY n.created_at ASC",
        [publicPatientId, hospitalId]
      );
      return result.rows;
    },
    async findStaffRoleByWallet(walletAddress) {
      const result = await query(
        "SELECT u.role FROM staff_chain_authorizations a JOIN users u ON u.id = a.user_id WHERE lower(a.wallet_address) = lower($1) LIMIT 1",
        [walletAddress]
      );
      return result.rows[0]?.role || "";
    },
    async createDemographicCorrection({ publicPatientId, hospitalId, contentCiphertext, actorId }) {
      const result = await query(
        "INSERT INTO patient_demographic_corrections (patient_id, hospital_id, content_ciphertext, created_by) SELECT id, $2, $3, $4 FROM patients WHERE patient_id=$1 AND hospital_id=$2 AND status='confirmed' RETURNING id, created_at AS \"createdAt\"",
        [publicPatientId, hospitalId, contentCiphertext, actorId]
      );
      if (!result.rowCount) {
        const error = new Error("Patient not found");
        error.statusCode = 404;
        throw error;
      }
      return result.rows[0];
    },
    async listDemographicCorrections(publicPatientId, hospitalId) {
      const result = await query(
        "SELECT c.content_ciphertext AS \"contentCiphertext\", c.created_at AS \"createdAt\", u.full_name AS \"authorName\" FROM patient_demographic_corrections c JOIN patients p ON p.id = c.patient_id LEFT JOIN users u ON u.id = c.created_by WHERE p.patient_id=$1 AND c.hospital_id=$2 ORDER BY c.created_at ASC",
        [publicPatientId, hospitalId]
      );
      return result.rows;
    },
    async createClinicalAudit(input) {
      const allowed = new Set(["record_created", "record_viewed", "record_corrected", "record_anchored", "summary_exported"]);
      if (!allowed.has(input.action)) {
        await this.recordActivity({
          actorId: input.actorId || null,
          actorRole: input.actorRole,
          hospitalId: input.hospitalId,
          publicPatientId: input.publicPatientId,
          action: input.action,
          category: "changes",
          outcome: "success",
          txHash: input.txHash || null
        });
        return;
      }
      if (input.action === "record_viewed") {
        const recent = await query(
          `SELECT 1 FROM clinical_audit_events e
           JOIN patients p ON p.id = e.patient_id
           WHERE p.patient_id=$1 AND e.hospital_id=$2 AND e.action='record_viewed'
             AND e.actor_role=$3 AND e.actor_id IS NOT DISTINCT FROM $4
             AND e.created_at > now() - interval '15 minutes'
           LIMIT 1`,
          [input.publicPatientId, input.hospitalId, input.actorRole, input.actorId || null]
        );
        if (recent.rowCount) return;
      }
      await query(
        "INSERT INTO clinical_audit_events (hospital_id, patient_id, actor_id, actor_role, action, category, version_index, tx_hash) SELECT $1, id, $3, $4, $5, $6, $7, $8 FROM patients WHERE patient_id=$2 AND hospital_id=$1 AND status='confirmed'",
        [input.hospitalId, input.publicPatientId, input.actorId || null, input.actorRole, input.action, input.category || null, Number.isInteger(input.versionIndex) ? input.versionIndex : null, input.txHash || null]
      );
    },
    async listClinicalAudit(publicPatientId, hospitalId) {
      const result = await query(
        "SELECT e.action, e.actor_role AS \"actorRole\", e.category, e.version_index AS \"versionIndex\", e.tx_hash AS \"txHash\", e.created_at AS \"createdAt\", u.full_name AS \"authorName\" FROM clinical_audit_events e JOIN patients p ON p.id=e.patient_id LEFT JOIN users u ON u.id=e.actor_id WHERE p.patient_id=$1 AND e.hospital_id=$2 ORDER BY e.created_at ASC",
        [publicPatientId, hospitalId]
      );
      return result.rows;
    },
    async createNursingIntake(input) {
      const result = await query(
        "INSERT INTO nursing_intake (patient_id,hospital_id,kind,status,content_ciphertext,content_hash,created_by) SELECT id,$2,$3,'pending_review',$4,$5,$6 FROM patients WHERE patient_id=$1 AND hospital_id=$2 AND status='confirmed' RETURNING id, kind, status, content_hash AS \"contentHash\", created_at AS \"createdAt\"",
        [input.publicPatientId, input.hospitalId, input.kind, input.contentCiphertext, input.contentHash, input.actorId]
      );
      if (!result.rowCount) {
        const error = new Error("Patient not found");
        error.statusCode = 404;
        throw error;
      }
      return result.rows[0];
    },
    async listNursingIntake(publicPatientId, hospitalId) {
      const result = await query(
        "SELECT n.id, n.kind, n.status, n.content_ciphertext AS \"contentCiphertext\", n.content_hash AS \"contentHash\", n.review_note_ciphertext AS \"reviewNoteCiphertext\", n.reviewed_at AS \"reviewedAt\", n.promoted_record_id AS \"promotedRecordId\", n.created_at AS \"createdAt\", u.full_name AS \"authorName\", p.patient_id AS \"patientId\" FROM nursing_intake n JOIN patients p ON p.id = n.patient_id LEFT JOIN users u ON u.id = n.created_by WHERE p.patient_id = $1 AND n.hospital_id = $2 AND p.status = 'confirmed' ORDER BY n.created_at ASC",
        [publicPatientId, hospitalId]
      );
      return result.rows;
    },
    async getNursingIntake(id, hospitalId) {
      const result = await query(
        "SELECT n.id, n.kind, n.status, n.content_ciphertext AS \"contentCiphertext\", n.content_hash AS \"contentHash\", n.review_note_ciphertext AS \"reviewNoteCiphertext\", n.reviewed_at AS \"reviewedAt\", n.promoted_record_id AS \"promotedRecordId\", n.created_at AS \"createdAt\", p.patient_id AS \"patientId\" FROM nursing_intake n JOIN patients p ON p.id = n.patient_id WHERE n.id = $1 AND n.hospital_id = $2",
        [id, hospitalId]
      );
      return result.rows[0] || null;
    },
    async reviewNursingIntake(input) {
      const result = await query(
        "UPDATE nursing_intake SET status = $3, review_note_ciphertext = $4, reviewed_by = $5, reviewed_at = now(), promoted_record_id = $6 WHERE id = $1 AND hospital_id = $2 AND status = 'pending_review' RETURNING id, status, promoted_record_id AS \"promotedRecordId\"",
        [input.id, input.hospitalId, input.status, input.reviewNoteCiphertext || null, input.reviewerId, input.promotedRecordId || null]
      );
      return result.rows[0] || null;
    },
    async listNursingQueue(hospitalId) {
      const result = await query(
        "SELECT n.id, n.kind, n.status, n.created_at AS \"createdAt\", p.patient_id AS \"patientId\" FROM nursing_intake n JOIN patients p ON p.id = n.patient_id WHERE n.hospital_id = $1 AND n.status = 'pending_review' ORDER BY n.created_at DESC LIMIT 30",
        [hospitalId]
      );
      return result.rows;
    },
    async listRecentPatients(hospitalId) {
      const result = await query(
        "SELECT patient_id AS \"patientId\", status, created_at AS \"createdAt\" FROM patients WHERE hospital_id = $1 AND status = 'confirmed' ORDER BY created_at DESC LIMIT 8",
        [hospitalId]
      );
      return result.rows;
    },
    async listPatientVisits(patientId) {
      const result = await query(
        "SELECT id, record_reference AS \"recordReference\", record_hash AS \"recordHash\", created_at AS \"createdAt\" FROM visits WHERE patient_id = $1 ORDER BY created_at ASC",
        [patientId]
      );
      return result.rows;
    },
    async close() { await pool.end(); }
  };
}

function reviewCandidateIds(values) {
  if (!values) return [];
  const source = Array.isArray(values) ? values : String(values).replace(/^\{|\}$/g, "").split(",");
  return source.map((id) => String(id).trim().toLowerCase()).filter((id) => id && id !== "null");
}

function classifyReview(review, { candidateIds = [], highConfidenceId = "" } = {}) {
  const candidates = new Set(reviewCandidateIds(review.candidateIds));
  const incoming = reviewCandidateIds(candidateIds);
  const strongId = String(highConfidenceId || "").trim().toLowerCase();
  const base = { reviewCaseId: review.id, newPatientId: review.newPatientId || null };
  if (review.case_status === "pending") {
    const novel = incoming.filter((id) => !candidates.has(id));
    return novel.length ? { ...base, action: "add_candidates" } : { ...base, action: "pending" };
  }
  if (review.case_status === "rejected") return { ...base, action: "rejected" };
  if (review.case_status === "resolved_same") {
    return { ...base, action: "same_person", patientId: review.linkedPublicId || null };
  }
  if (review.case_status === "resolved_different" && review.patientStatus === "pending") {
    if (strongId && !candidates.has(strongId)) return { action: "existing" };
    const novel = incoming.filter((id) => !candidates.has(id));
    if (novel.length) return { ...base, action: "new_candidates" };
    return { ...base, action: "authorized" };
  }
  if (review.case_status === "resolved_different") {
    return { ...base, action: "used", patientId: review.publicPatientId || null };
  }
  return { ...base, action: "used", patientId: review.publicPatientId || null };
}

async function sameIdentityHashes(query, patientId, hashes) {
  const stored = await query(
    "SELECT field_name AS \"fieldName\", field_hash AS \"fieldHash\" FROM patient_identity_hashes WHERE patient_id=$1",
    [patientId]
  );
  const requested = hashes.map(([field, hash]) => `${field}:${hash}`).sort().join("|");
  const recorded = stored.rows.map((row) => `${row.fieldName}:${row.fieldHash}`).sort().join("|");
  return requested === recorded;
}

async function loadReviewAuthorizations(query, hospitalId, { reviewCaseId, fingerprint }) {
  const columns = `rc.id, rc.case_status, rc.request_fingerprint, rc.candidate_patient_ids AS "candidateIds", rc.new_patient_id AS "newPatientId", p.status AS "patientStatus", p.patient_id AS "publicPatientId", linked.patient_id AS "linkedPublicId"`;
  const joins = "FROM review_cases rc JOIN patients p ON p.id = rc.new_patient_id LEFT JOIN patients linked ON linked.id = rc.linked_patient_id";
  const result = reviewCaseId
    ? await query(`SELECT ${columns} ${joins} WHERE rc.id=$1 AND rc.hospital_id=$2`, [reviewCaseId, hospitalId])
    : await query(
      `SELECT ${columns} ${joins} WHERE rc.hospital_id=$1 AND rc.request_fingerprint=$2 ORDER BY rc.created_at DESC LIMIT 20`,
      [hospitalId, fingerprint]
    );
  return result.rows;
}

const IDENTIFYING_FIELDS = new Set(["fullName", "dateOfBirth", "mobile", "email"]);

function identifyingHashes(hashes) {
  return (hashes || []).filter(([field]) => IDENTIFYING_FIELDS.has(field));
}

function classifyIdentityOverlap(fieldNames) {
  const fields = new Set((fieldNames || []).filter((name) => IDENTIFYING_FIELDS.has(name)));
  if (!fields.size) return "none";
  const name = fields.has("fullName");
  const dob = fields.has("dateOfBirth");
  const contact = fields.has("mobile") || fields.has("email");
  if ((name && dob && contact) || fields.size >= 3) return "high";
  if (fields.has("mobile") || fields.has("email") || name) return "possible";
  return "none";
}

function decidePatientMatch(rows) {
  const grouped = new Map();
  for (const row of rows || []) {
    const id = String(row.id || "").trim().toLowerCase();
    if (!id) continue;
    const current = grouped.get(id) || { id, patient_id: row.patient_id || row.patientId || null, did: row.did || null, fields: [] };
    const field = row.fieldName || row.field_name;
    if (field) current.fields.push(field);
    grouped.set(id, current);
  }
  const ranked = [...grouped.values()]
    .map((row) => ({ ...row, strength: classifyIdentityOverlap(row.fields) }))
    .filter((row) => row.strength !== "none");
  if (!ranked.length) return { status: "no_match", candidateCount: 0, candidates: [] };
  const high = ranked.filter((row) => row.strength === "high");
  const candidates = ranked.map((row) => row.id);
  if (high.length === 1) {
    const patient = high[0];
    return {
      status: "high_confidence",
      patient: { id: patient.id, patient_id: patient.patient_id, did: patient.did },
      candidateCount: ranked.length,
      candidates
    };
  }
  return { status: "possible_match", candidateCount: ranked.length, candidates };
}

module.exports = { createDb, poolConfig, classifyReview, decidePatientMatch, identifyingHashes };
