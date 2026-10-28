// Pump Group site board: the server-side actions that need the service role.
//   member_add, member_reset   a signed-in site board editor (Supabase Auth JWT): add a person, or give a new temporary password
//   sync_key, sync             the sync workflow in Katiso0623/pumpgroup-site-board (GitHub OIDC, main branch only).
//                              sync_key makes the sealing key pair the first time: the private key goes straight into the
//                              project vault and only the public key comes out. sync brings in one sealed file from the
//                              repository's sync/ folder (board reference data, records, photos, project documents). A
//                              sealed file must also carry a signature from the sealing tool's signing key (pinned below),
//                              so a file that anyone else seals with the public key is refused.
// Everything else the website does goes through the sb_* database functions with the person's own sign-in.
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";
import * as jose from "npm:jose@5.9.6";

const BUCKET = "site-board";
const REPO = "Katiso0623/pumpgroup-site-board";
// GitHub's fixed numbers for the repository and its owner, so a repository later made under the same name is refused
const REPO_ID = "1437260227";
const REPO_OWNER_ID = "341032409";
const AUDIENCE = "pumpgroup-site-board-sync";
// public halves of the keys allowed to sign sealed files (Ed25519, base64 of the 32 raw bytes), by key id
const SIGNERS: Record<string, string> = {"945b051ee7c2d332": "l7lCSszm6LYjWGE1gDVoMmSXbHWbNq0yhYZOoGaf7dk="};
const JWKS = jose.createRemoteJWKSet(new URL("https://token.actions.githubusercontent.com/.well-known/jwks"));
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
class UserError extends Error {}

const DOC_PATH = /^[A-Za-z0-9 _.,()&+~-]+(\/[A-Za-z0-9 _.,()&+~-]+)*$/;
const FILE_TYPES = new Set([
  "image/jpeg", "image/png", "image/webp", "image/gif", "application/pdf", "video/mp4", "video/quicktime", "video/webm",
  "text/csv", "text/plain", "application/json", "application/zip", "application/x-zip-compressed", "application/octet-stream",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/msword", "application/vnd.ms-excel", "application/vnd.ms-project", "application/xml", "text/xml",
]);
const ASSET_TYPES = /^(image\/(jpeg|png|webp|gif)|application\/pdf|video\/(mp4|quicktime|webm)|text\/(csv|plain)|application\/json|application\/zip|application\/vnd\.openxmlformats-officedocument\.(wordprocessingml\.document|spreadsheetml\.sheet|presentationml\.presentation)|application\/msword|application\/vnd\.ms-excel)$/;

function tempPassword(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const a = crypto.getRandomValues(new Uint8Array(12));
  const s = Array.from(a, (x) => chars[x % chars.length]).join("");
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}`;
}
const hex = (n: number) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => b.toString(16).padStart(2, "0")).join("");

async function findUserByEmail(admin: SupabaseClient, email: string) {
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const hit = data.users.find((u) => (u.email || "").toLowerCase() === email);
    if (hit) return hit;
    if (data.users.length < 200) return null;
  }
  return null;
}

async function call(admin: SupabaseClient, fn: string, args: Record<string, unknown>) {
  const { data, error } = await admin.rpc(fn, args);
  if (error) throw new UserError(error.message);
  return data;
}

// ---------- team ----------
async function memberAdd(admin: SupabaseClient, caller: string, body: any) {
  const email = String(body.email || "").trim().toLowerCase();
  const name = String(body.full_name || "").trim().slice(0, 120);
  const role = String(body.role || "viewer");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 254) throw new UserError("Enter a valid email address.");
  if (!name) throw new UserError("Enter the person's full name.");
  await call(admin, "sb_admin_member_check", { p_caller: caller, p_role: role });   // before any login is created or changed
  let user = await findUserByEmail(admin, email);
  let password: string | null = null;
  let created = false;
  if (!user) {
    password = tempPassword();
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: name } });
    if (error) throw new UserError(error.message);
    user = data.user;
    created = true;
  } else if (!(await call(admin, "sb_admin_is_staff", { p_user: user.id }))) {
    // a login that is not a Tender Desk login could have been made by anyone (for instance by signing up with this
    // address before it was added here), so it gets a new temporary password that only the person adding them sees
    await call(admin, "sb_admin_member_can_add", { p_caller: caller, p_user: user.id, p_role: role });
    password = tempPassword();
    const { error } = await admin.auth.admin.updateUserById(user.id, { password, email_confirm: true });
    if (error) throw new UserError(error.message);
  }
  try {
    await call(admin, "sb_admin_member_add", { p_caller: caller, p_user: user!.id, p_email: email, p_name: name, p_role: role, p_temp: !!password });
  } catch (e) {
    if (created) await admin.auth.admin.deleteUser(user!.id).catch(() => {});   // nothing half-made is left behind
    throw e;
  }
  return password ? { ok: true, email, temp_password: password, existing: !created } : { ok: true, email, existing: true };
}

async function memberReset(admin: SupabaseClient, caller: string, body: any) {
  const target = String(body.user_id || "");
  if (!/^[0-9a-f-]{36}$/i.test(target)) throw new UserError("That person is not on the site board team.");
  const t = await call(admin, "sb_admin_member_check", { p_caller: caller, p_target: target });
  const password = tempPassword();
  const { error } = await admin.auth.admin.updateUserById(target, { password, email_confirm: true });
  if (error) throw new UserError(error.message);
  await call(admin, "sb_admin_mark_temp", { p_user: target });
  return { ok: true, email: t.email, temp_password: password };
}

// ---------- sealed sync files ----------
const b64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const b64of = (u: Uint8Array) => { let s = ""; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };
async function sha256(buf: Uint8Array) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", buf as BufferSource)), (b) => b.toString(16).padStart(2, "0")).join("");
}

// makes the key pair once: the private key goes into the vault, the public key is kept for the sealing tool to read
async function ensureKey(admin: SupabaseClient) {
  const { data: have, error: e1 } = await admin.rpc("sb_admin_sync_public");
  if (e1) throw new Error(e1.message);
  if (have) return { created: false, public_key: String(have) };
  const kp = await crypto.subtle.generateKey({ name: "RSA-OAEP", modulusLength: 3072, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["encrypt", "decrypt"]);
  const priv = b64of(new Uint8Array(await crypto.subtle.exportKey("pkcs8", kp.privateKey)));
  const spki = b64of(new Uint8Array(await crypto.subtle.exportKey("spki", kp.publicKey)));
  const pem = "-----BEGIN PUBLIC KEY-----\n" + (spki.match(/.{1,64}/g) || []).join("\n") + "\n-----END PUBLIC KEY-----\n";
  const { data: made, error: e2 } = await admin.rpc("sb_admin_sync_key_init", { p_private: priv, p_public: pem });
  if (e2) throw new Error(e2.message);
  if (!made) {   // made at the same moment by another run: use that one
    const { data: again } = await admin.rpc("sb_admin_sync_public");
    return { created: false, public_key: String(again || "") };
  }
  return { created: true, public_key: pem };
}

let privKey: CryptoKey | null = null;
async function openSealed(admin: SupabaseClient, buf: Uint8Array) {
  const magic = new TextDecoder().decode(buf.slice(0, 6));
  if (magic !== "PGSB2\n" || buf.length < 10 + 64) throw new UserError("not a signed site board file");
  const hl = new DataView(buf.buffer, buf.byteOffset + 6, 4).getUint32(0);
  if (10 + hl + 64 > buf.length) throw new UserError("damaged sealed file");
  const head = JSON.parse(new TextDecoder().decode(buf.slice(10, 10 + hl)));
  // the signature (last 64 bytes) covers everything before it
  const signer = SIGNERS[String(head.sk || "")];
  if (!signer) throw new UserError("sealed file signed with an unknown key");
  const vk = await crypto.subtle.importKey("raw", b64(signer), { name: "Ed25519" }, false, ["verify"]);
  const body = buf.slice(0, buf.length - 64), sig = buf.slice(buf.length - 64);
  if (!(await crypto.subtle.verify({ name: "Ed25519" }, vk, sig, body))) throw new UserError("sealed file signature does not match");
  if (!privKey) {
    const { data, error } = await admin.rpc("sb_admin_sync_key");
    if (error || !data) throw new Error("the sync key is not set up");
    privKey = await crypto.subtle.importKey("pkcs8", b64(String(data).replace(/\s+/g, "")), { name: "RSA-OAEP", hash: "SHA-256" }, false, ["decrypt"]);
  }
  const raw = new Uint8Array(await crypto.subtle.decrypt({ name: "RSA-OAEP" }, privKey, b64(head.ek)));
  const key = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["decrypt"]);
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64(head.iv), additionalData: buf.slice(0, 10 + hl) }, key, buf.slice(10 + hl, buf.length - 64)));
  const ml = new DataView(plain.buffer, plain.byteOffset, 4).getUint32(0);
  const meta = JSON.parse(new TextDecoder().decode(plain.slice(4, 4 + ml)));
  return { meta, payload: plain.slice(4 + ml) };
}

async function upload(admin: SupabaseClient, name: string, payload: Uint8Array, type: string, upsert: boolean) {
  const up = await admin.storage.from(BUCKET).upload(name, payload, { contentType: type, upsert, cacheControl: "0" });
  if (up.error) throw new UserError(`upload failed: ${up.error.message}`);
}

async function syncOne(admin: SupabaseClient, sha: string, name: string) {
  if (!/^[A-Za-z0-9._-]+\.sealed$/.test(name) || !/^[0-9a-f]{40}$/.test(sha)) throw new UserError("bad sync request");
  const res = await fetch(`https://raw.githubusercontent.com/${REPO}/${sha}/sync/${name}`);
  if (!res.ok) throw new UserError(`could not fetch the file (${res.status})`);
  const buf = new Uint8Array(await res.arrayBuffer());
  const digest = await sha256(buf);
  const { data: seen, error: seenErr } = await admin.rpc("sb_admin_sync_seen", { p_sha: digest });
  if (seenErr) throw new Error(seenErr.message);
  if (seen) return { kind: null, status: "already applied", result: null };
  const { meta, payload } = await openSealed(admin, buf);
  let result: unknown;
  switch (meta.kind) {
    case "app":
      if (!/^[a-z0-9_]{1,40}$/.test(String(meta.key))) throw new UserError("bad app key");
      result = await call(admin, "sb_admin_put_app", { p_key: meta.key, p_value: JSON.parse(new TextDecoder().decode(payload)), p_level: meta.level ?? 1 });
      break;
    case "docs": {
      const docs = JSON.parse(new TextDecoder().decode(payload));
      let by: string | null = null;
      if (meta.by_email) { const u = await findUserByEmail(admin, String(meta.by_email).toLowerCase()); by = u ? u.id : null; }
      result = await call(admin, "sb_admin_put_docs", { p_docs: docs, p_replace: !!meta.replace, p_by: by });
      break;
    }
    case "asset": {
      const id = String(meta.id || ""), type = String(meta.type || "");
      if (!/^[0-9a-f]{32}$/.test(id)) throw new UserError("bad asset id");
      if (!ASSET_TYPES.test(type)) throw new UserError("bad asset type");
      await upload(admin, `a/${id}`, payload, type, true);
      result = await call(admin, "sb_admin_put_asset", { p_id: id, p_type: type, p_size: payload.byteLength, p_level: meta.level ?? 1, p_by: null });
      break;
    }
    case "file": {
      const path = String(meta.path || ""), type = String(meta.type || "application/octet-stream");
      if (!DOC_PATH.test(path) || new TextEncoder().encode(path).length > 600 || ("/" + path).includes("/.")) throw new UserError("bad document name");
      if (!FILE_TYPES.has(type)) throw new UserError("bad document type");
      const obj = hex(16);
      await upload(admin, `d/${obj}`, payload, type, false);
      const r = await call(admin, "sb_admin_put_file", { p_path: path, p_type: type, p_size: payload.byteLength, p_level: meta.level ?? 3, p_obj: obj });
      if (r && r.old) {
        const { error } = await admin.storage.from(BUCKET).remove([`d/${r.old}`]);
        if (error) console.error("old copy not removed", r.old, error.message);
      }
      result = { ok: true };
      break;
    }
    case "owner": {
      const u = await findUserByEmail(admin, String(meta.email || "").toLowerCase());
      if (!u) throw new UserError("no login for the owner's email address");
      result = await call(admin, "sb_admin_set_owner", { p_user: u.id, p_email: u.email, p_name: meta.name || "" });
      break;
    }
    case "test_users": {
      // short-lived accounts for checking the access rules end to end; only *.invalid addresses, never the owner,
      // removed with remove: true
      const out: unknown[] = [];
      for (const t of meta.users || []) {
        const email = String(t.email || "").toLowerCase();
        if (!email.endsWith(".invalid")) throw new UserError("test accounts must use .invalid addresses");
        if (!meta.remove && !["editor", "contributor", "viewer"].includes(String(t.role))) throw new UserError("test accounts are editors, contributors or viewers");
        const u = await findUserByEmail(admin, email);
        if (meta.remove) {
          if (u) {
            const { error: me } = await admin.from("sb_members").delete().eq("user_id", u.id);
            if (me) throw new UserError(me.message);
            const { error } = await admin.auth.admin.deleteUser(u.id);
            if (error) throw new UserError(error.message);
          }
          out.push({ removed: !!u });
          continue;
        }
        let id = u?.id;
        if (!u) {
          const { data, error } = await admin.auth.admin.createUser({ email, password: t.password, email_confirm: true });
          if (error) throw new UserError(error.message);
          id = data.user!.id;
        } else {
          const { error } = await admin.auth.admin.updateUserById(u.id, { password: t.password });
          if (error) throw new UserError(error.message);
        }
        const { error } = await admin.from("sb_members").upsert({ user_id: id, email, full_name: t.name || email, role: t.role, active: true, must_change_password: false });
        if (error) throw new UserError(error.message);
        out.push({ role: t.role });
      }
      result = out;
      break;
    }
    default:
      throw new UserError("unknown sync kind");
  }
  const { error: doneErr } = await admin.rpc("sb_admin_sync_done", { p_sha: digest, p_name: name, p_kind: meta.kind, p_result: result as any });
  if (doneErr) throw new Error(doneErr.message);
  return { kind: meta.kind, status: "applied", result };
}

// the sync workflow proves who it is with GitHub's OIDC token: this repository (by its fixed numbers), main, sync.yml
async function fromSyncWorkflow(tok: string, sha: string) {
  try {
    const { payload } = await jose.jwtVerify(tok, JWKS, { issuer: "https://token.actions.githubusercontent.com", audience: AUDIENCE });
    const wf = String(payload.job_workflow_ref || payload.workflow_ref || "").toLowerCase();
    return String(payload.repository || "").toLowerCase() === REPO.toLowerCase()
      && String(payload.repository_id || "") === REPO_ID && String(payload.repository_owner_id || "") === REPO_OWNER_ID
      && payload.ref === "refs/heads/main" && ["push", "workflow_dispatch"].includes(String(payload.event_name || ""))
      && wf.startsWith(`${REPO.toLowerCase()}/.github/workflows/sync.yml@`)
      && (sha === "" || payload.sha === sha);
  } catch (_) { return false; }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  let body: any = {};
  try { body = await req.json(); } catch (_) { body = {}; }
  const op = String(body.op || "");
  const tok = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (op === "sync" || op === "sync_key") {
    // the workflow's log is public: it gets only a short status; the detail stays in sb_sync_log and the function log
    const sha = String(body.sha || "");
    if (!(await fromSyncWorkflow(tok, sha))) return json({ status: "forbidden" }, 403);
    try {
      if (op === "sync_key") { const k = await ensureKey(admin); return json({ status: k.created ? "key made" : "key ready" }); }
      const r = await syncOne(admin, sha, String(body.file || ""));
      if (r.status === "applied") console.log("sync", body.file, r.kind, JSON.stringify(r.result).slice(0, 500));
      return json({ status: r.status, kind: r.kind });
    } catch (e) {
      console.error("sync failed", body.file, e instanceof Error ? e.message : String(e));
      return json({ status: "failed" }, e instanceof UserError ? 400 : 500);
    }
  }
  try {
    const { data: u } = await admin.auth.getUser(tok);
    if (!u?.user) return json({ error: "Please sign in again." }, 401);
    if (op === "member_add") return json(await memberAdd(admin, u.user.id, body));
    if (op === "member_reset") return json(await memberReset(admin, u.user.id, body));
    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!(e instanceof UserError)) console.error(op, msg);
    return json({ error: e instanceof UserError ? msg : "Something went wrong on the server. Try again." }, e instanceof UserError ? 400 : 500);
  }
});
