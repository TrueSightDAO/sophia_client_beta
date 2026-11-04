/**
 * identity.js — "Link to DAO identity" via the credentialing platform.
 *
 * Same mechanism as oracle.truesight.me / capoeira.agroverse.shop: the browser
 * holds an anonymous RSA keypair; "linking" submits an `[EMAIL REGISTERED EVENT]`
 * to Edgar (edgar.truesight.me), Edgar emails a verification link, and once that
 * link is clicked in THIS browser the key becomes ACTIVE on the ledger and the
 * contributor's name/roles resolve from it.
 */
(function () {
  'use strict';

  const EDGAR_BASE = 'https://edgar.truesight.me';
  const VERIFY_URL = 'https://dapp.truesight.me/verify_request.html';

  function buildEventPayload(eventName, fields) {
    const ts = new Date().toISOString();
    const augmented = { Timestamp: ts };
    Object.keys(fields || {}).forEach((k) => { augmented[k] = fields[k]; });
    const lines = Object.keys(augmented)
      .filter((k) => augmented[k] !== undefined && augmented[k] !== null)
      .map((k) => '- ' + k + ': ' + String(augmented[k]));
    return '[' + eventName + ']\n' + lines.join('\n') + '\n--------';
  }

  function buildShareText(payload, txId, publicKey, source) {
    return [
      payload,
      '',
      'My Digital Signature: ' + publicKey,
      '',
      'Request Transaction ID: ' + txId,
      '',
      'This submission was generated using ' + (source || window.location.href),
      '',
      'Verify submission here: ' + VERIFY_URL,
    ].join('\n');
  }

  /**
   * Register an email against the current key (anonymous → pending verification).
   * @returns {Promise<{ok:boolean, status?:string, error?:string}>}
   */
  async function registerEmail(email, publicKey, privateKey, source) {
    const payload = buildEventPayload('EMAIL REGISTERED EVENT', { Email: email });
    const txId = await window.SophiaCrypto.signString(privateKey, payload);
    const shareText = buildShareText(payload, txId, publicKey, source);

    const form = new FormData();
    form.append('text', shareText);

    let resp;
    try {
      resp = await fetch(EDGAR_BASE + '/dao/submit_contribution', { method: 'POST', body: form });
    } catch (e) {
      return { ok: false, error: 'Network error: ' + (e && e.message ? e.message : e) };
    }

    if (!resp.ok) {
      let detail = 'HTTP ' + resp.status;
      try { const j = await resp.json(); if (j && j.error) detail = j.error; } catch (e) { /* ignore */ }
      return { ok: false, error: detail };
    }

    let data = {};
    try { data = await resp.json(); } catch (e) { /* ignore */ }
    if (data && data.email_registration && data.email_registration.applicable) {
      const er = data.email_registration;
      if (er.ok === false) {
        if (er.pubkey_mismatch) return { ok: false, error: 'Public-key mismatch — open the email link in THIS browser.' };
        if (er.not_found) return { ok: false, error: 'Registration not found.' };
        return { ok: false, error: 'Registration failed.' };
      }
      if (er.activated) return { ok: true, status: 'activated', email: er.contributor_email };
      if (er.pending_verification) return { ok: true, status: 'pending_verification', email: er.contributor_email };
      if (er.already_consumed) return { ok: true, status: 'already_consumed', email: er.contributor_email };
    }
    return { ok: true, status: 'submitted' };
  }

  /**
   * Query Edgar for this key's registration status.
   * @returns {Promise<{registered:boolean, pending_verification?:boolean, contributor_name?:string, contributor_email?:string, error?:string}>}
   */
  async function checkRegistration(publicKey) {
    const url = EDGAR_BASE + '/dao/check_digital_signature?signature=' + encodeURIComponent(publicKey);
    let resp;
    try {
      resp = await fetch(url, { method: 'GET', cache: 'no-store' });
    } catch (e) {
      return { registered: false, error: 'Network error' };
    }
    if (resp.status === 404) return { registered: false };
    if (!resp.ok) return { registered: false, error: 'HTTP ' + resp.status };
    let data = {};
    try { data = await resp.json(); } catch (e) { /* ignore */ }
    if (data.registered === true) {
      return { registered: true, contributor_name: data.contributor_name, contributor_email: data.contributor_email };
    }
    if (data.pending_verification === true) {
      return { registered: false, pending_verification: true, contributor_email: data.contributor_email };
    }
    return { registered: false, error: data.error || 'Unregistered' };
  }

  /**
   * Complete the email verification: submit [EMAIL VERIFICATION EVENT] with the
   * verification key from the emailed link.
   * @returns {Promise<{ok:boolean, error?:string}>}
   */
  async function verifyEmail(email, vk, publicKey, privateKey, source) {
    const payload = buildEventPayload('EMAIL VERIFICATION EVENT', { Email: email, 'Verification Key': vk });
    const txId = await window.SophiaCrypto.signString(privateKey, payload);
    const shareText = buildShareText(payload, txId, publicKey, source);

    const form = new FormData();
    form.append('text', shareText);

    let resp;
    try {
      resp = await fetch(EDGAR_BASE + '/dao/submit_contribution', { method: 'POST', body: form });
    } catch (e) {
      return { ok: false, error: 'Network error: ' + (e && e.message ? e.message : e) };
    }
    if (!resp.ok) {
      let detail = 'HTTP ' + resp.status;
      try { const j = await resp.json(); if (j && j.error) detail = j.error; } catch (e) { /* ignore */ }
      return { ok: false, error: detail };
    }
    return { ok: true };
  }

  /** Read ?em=…&vk=… from the URL (the emailed verification link params). */
  function verificationParams() {
    try {
      const p = new URLSearchParams(window.location.search);
      const em = p.get('em');
      const vk = p.get('vk');
      if (em && vk) return { em, vk };
    } catch (e) { /* ignore */ }
    return null;
  }

  function credentialUrl(publicKey) {
    // slug = pk-<sha256[:?]> — but the client does not compute the exact slug;
    // the credential page accepts the raw key too. Return the plain program page.
    return 'https://truesight.me/';
  }

  window.SophiaIdentity = { registerEmail, verifyEmail, checkRegistration, buildEventPayload, verificationParams, credentialUrl };
})();
