'use strict';

const config = require('../config');

let transporter = null;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}[c]));

function getSender() {
  const from = config.smtp.from || '';
  const match = from.match(/^(.*?)\s*<([^<>]+)>$/);

  const name = match ? match[1].trim().replace(/^["']|["']$/g, '') : 'Voyagéo';
  const email = (match ? match[2] : from).trim();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('MAIL_FROM doit être une adresse e-mail d’expéditeur vérifiée.');
  }

  return { name: name || 'Voyagéo', email };
}

function getTransporter() {
  if (process.env.CLOUDFLARE_WORKERS === '1') return null;
  if (!config.smtp.host) return null;

  if (!transporter) {
    const nodemailer = require('nodemailer');
    transporter = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.secure,
      auth: config.smtp.user
        ? { user: config.smtp.user, pass: config.smtp.pass }
        : undefined,
    });
  }

  return transporter;
}

async function sendMail({ to, subject, text, html }) {
  const apiKey = process.env.BREVO_API_KEY;

  if (apiKey) {
    try {
      const response = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
          'accept': 'application/json',
          'api-key': apiKey,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          sender: getSender(),
          to: [{ email: String(to).trim() }],
          subject,
          textContent: text,
          htmlContent: html,
        }),
      });

      if (!response.ok) {
        console.error('[e-mail] Brevo a refusé l’envoi. HTTP', response.status);
        return false;
      }

      return true;
    } catch (error) {
      console.error('[e-mail] Échec de la requête Brevo :', error.message);
      return false;
    }
  }

  // Cloudflare Workers ne doit pas tenter d'ouvrir une connexion SMTP.
  if (process.env.CLOUDFLARE_WORKERS === '1') {
    console.error('[e-mail] BREVO_API_KEY non configurée.');
    return false;
  }

  const t = getTransporter();
  if (!t) {
    console.log(`[e-mail désactivé] pour ${to} : ${subject}`);
    return false;
  }

  try {
    await t.sendMail({
      from: config.smtp.from,
      to,
      subject,
      text,
      html,
    });
    return true;
  } catch (error) {
    console.error('[e-mail] Échec SMTP :', error.message);
    return false;
  }
}

async function sendTicketEmail(to, r) {
  const lien = `${config.baseUrl}/ticket.html?n=${encodeURIComponent(r.numero_ticket)}`;
  const resume = `${r.ville_depart} - ${r.ville_arrivee}, le ${r.date_depart} à ${r.heure_depart}, place ${r.numero_place}`;

  return sendMail({
    to,
    subject: `Votre ticket ${r.numero_ticket} - ${config.appName}`,
    text: `Bonjour ${r.prenom_passager},\n\nVotre réservation est confirmée.\nTicket : ${r.numero_ticket}\nVoyage : ${resume}\nCompagnie : ${r.compagnie_nom}\n\nVotre ticket : ${lien}\n\nBon voyage !\n${config.appName}`,
    html: `<div style="font-family:Arial,sans-serif;max-width:520px"><h2 style="color:#1F3A5F">Votre réservation est confirmée</h2>
      <p>Bonjour ${esc(r.prenom_passager)},</p><p><strong>Ticket : ${esc(r.numero_ticket)}</strong><br>${esc(resume)}<br>Compagnie : ${esc(r.compagnie_nom)}</p>
      <p><a href="${esc(lien)}" style="background:#F28C28;color:#1F3A5F;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:bold">Voir mon ticket</a></p>
      <p style="color:#5B6770">Bon voyage ! L'équipe ${esc(config.appName)}</p></div>`,
  });
}

async function sendCodeEmail(to, { code, motif }) {
  const minutes = config.codes.ttlMinutes;
  const titre = motif === 'reset'
    ? 'Réinitialisation de votre mot de passe'
    : 'Confirmez votre adresse e-mail';

  const intro = motif === 'reset'
    ? 'Voici le code pour choisir un nouveau mot de passe :'
    : `Bienvenue sur ${config.appName} ! Voici votre code de confirmation :`;

  const ok = await sendMail({
    to,
    subject: `${code} est votre code ${config.appName}`,
    text: `${titre}\n\n${intro}\n\n${code}\n\nCe code est valable ${minutes} minutes. Si vous n'êtes pas à l'origine de cette demande, ignorez ce message : rien ne sera modifié.\n${config.appName}`,
    html: `<div style="font-family:Arial,sans-serif;max-width:480px"><h2 style="color:#1F3A5F">${esc(titre)}</h2><p>${esc(intro)}</p>
      <p style="font-size:34px;letter-spacing:8px;font-weight:bold;color:#1F3A5F;background:#F2F5F8;padding:14px 18px;border-radius:8px;text-align:center">${esc(code)}</p>
      <p style="color:#5B6770">Ce code est valable ${minutes} minutes. Si vous n'êtes pas à l'origine de cette demande, ignorez ce message : rien ne sera modifié.</p>
      <p style="color:#5B6770">L'équipe ${esc(config.appName)}</p></div>`,
  });

  if (!ok) {
    const { AppError } = require('../utils/errors');
    throw new AppError(
      502,
      "Impossible d'envoyer l'e-mail pour le moment. Vérifiez l'adresse ou réessayez dans un instant.",
      'MAIL_FAIL',
    );
  }

  return true;
}

module.exports = { sendMail, sendTicketEmail, sendCodeEmail };
