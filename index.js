const makeWASocket = require("@whiskeysockets/baileys").default;
const {
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason,
} = require("@whiskeysockets/baileys");
const P = require("pino");
const dotenv = require("dotenv");
const { Boom } = require("@hapi/boom");
const express = require("express");
const { createClient } = require("@supabase/supabase-js");
const qrcode = require("qrcode");

dotenv.config();
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// Variável global para armazenar a string do QR Code
let qrCodeData = null;

// --- Fila de Notificações Anti-Spam ---
const notificationQueue = [];
let isProcessingQueue = false;

async function processQueue(sock) {
  if (isProcessingQueue || notificationQueue.length === 0) return;
  isProcessingQueue = true;

  const job = notificationQueue.shift();

  try {
    await sock.sendMessage(job.recipient, { text: job.message });
    console.log(`✅ Notificação enviada para ${job.recipient}`);
  } catch (e) {
    console.error(`❌ Falha ao enviar notificação para ${job.recipient}:`, e);
  }

  const delay = Math.floor(Math.random() * (20000 - 7000 + 1)) + 7000;
  console.log(`[Anti-Spam] Aguardando ${delay / 1000}s...`);
  setTimeout(() => {
    isProcessingQueue = false;
    processQueue(sock);
  }, delay);
}

async function startSock() {
  const { state, saveCreds } = await useMultiFileAuthState("auth");
  const { version } = await fetchLatestBaileysVersion();
  const sock = makeWASocket({
    version,
    logger: P({ level: "silent" }),
    auth: state,
  });

  startApiServer(sock);

  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      qrCodeData = qr;
      const publicUrl = process.env.PUBLIC_URL;
      if (publicUrl) {
        console.log("\n--------------------------------------------------");
        console.log("                QR CODE PRONTO!                   ");
        console.log("--------------------------------------------------");
        console.log(`➡️  Escaneie: ${publicUrl}/qr`);
        console.log("--------------------------------------------------\n");
      } else {
        console.log("[!] PUBLIC_URL não configurado. Use /qr manualmente.");
      }
    }

    if (connection === "close") {
      qrCodeData = null;
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log("🔌 Conexão encerrada. Reconectar?", shouldReconnect);
      if (shouldReconnect) startSock();
    } else if (connection === "open") {
      qrCodeData = null;
      console.log("✅ Bot conectado ao WhatsApp.");
      processQueue(sock);
    }
  });

  const handleCadastroResponsavel = require("./handlerCadastroResponsavel");
  sock.ev.on("messages.upsert", async ({ messages }) => {
    const msg = messages[0];
    if (!msg.message || msg.key.fromMe) return;
    await handleCadastroResponsavel(sock, msg);
  });

  sock.ev.on("creds.update", saveCreds);
}

function startApiServer(sock) {
  const app = express();
  app.use(express.json());
  const PORT = process.env.BOT_API_PORT || 3000;
  const SECRET_KEY = process.env.BOT_API_SECRET;

  app.post('/notificar-falta', async (req, res) => {
    try {
      if (req.headers['x-secret-key'] !== SECRET_KEY) {
        return res.status(403).send('Acesso negado.');
      }

      const { alunoId, dataFalta } = req.body;
      if (!alunoId || !dataFalta) {
        return res.status(400).send('Dados ausentes.');
      }

      const { data: aluno, error } = await supabase
        .from('alunos')
        .select('nome, nome_responsavel, telefone_responsavel')
        .eq('id', alunoId)
        .single();

      if (error) {
        console.error("Erro ao buscar aluno:", error);
        return res.status(500).send('Erro ao buscar aluno no banco.');
      }
      if (!aluno) {
        return res.status(404).send('Aluno não encontrado.');
      }
      if (!aluno.telefone_responsavel || !aluno.nome_responsavel) {
        return res.status(400).send('Dados do responsável incompletos.');
      }

      const dataFormatada = new Date(dataFalta).toLocaleDateString('pt-BR', { timeZone: 'UTC' });
      const templates = [
        `Olá, ${aluno.nome_responsavel}. Informamos que o(a) aluno(a) ${aluno.nome} não compareceu à escola no dia ${dataFormatada}.`,
        `Prezado(a) ${aluno.nome_responsavel}, detectamos ausência do(a) estudante ${aluno.nome} na data de ${dataFormatada}.`,
        `Atenção, ${aluno.nome_responsavel}. O(a) aluno(a) ${aluno.nome} faltou no dia ${dataFormatada}. Caso queira justificar, contate a secretaria da escola.`
      ];

      const mensagem = templates[Math.floor(Math.random() * templates.length)];
      const numeroResponsavel = `${aluno.telefone_responsavel}@s.whatsapp.net`;

      const duplicada = notificationQueue.find(q =>
        q.recipient === numeroResponsavel && q.message.includes(dataFormatada)
      );
      if (duplicada) {
        return res.status(200).send('Notificação já está na fila.');
      }

      notificationQueue.push({ recipient: numeroResponsavel, message: mensagem });
      console.log(`[Fila] Notificação para ${aluno.nome} adicionada à fila.`);
      processQueue(sock);

      res.status(200).send('Notificação enfileirada.');
    } catch (err) {
      console.error("❌ Erro no endpoint /notificar-falta:", err);
      res.status(500).send('Erro interno no servidor.');
    }
  });

  app.get('/qr', async (req, res) => {
    if (qrCodeData) {
      try {
        const qrImage = await qrcode.toDataURL(qrCodeData, { width: 400 });
        res.send(`
          <!DOCTYPE html><html lang="pt-br"><head><meta charset="UTF-8"><title>QR Code WhatsApp</title>
          <style>body{display:flex;flex-direction:column;justify-content:center;align-items:center;height:100vh;margin:0;background:#f0f2f5;font-family:sans-serif;}
          img{max-width:90%;width:350px;height:350px;border:1px solid #ddd;padding:10px;background:white;box-shadow:0 4px 8px rgba(0,0,0,0.1);}
          h1{color:#444;}</style></head>
          <body><h1>Aponte a câmera do seu WhatsApp aqui</h1><img src="${qrImage}" alt="QR Code para WhatsApp"></body></html>
        `);
      } catch (err) {
        console.error("Erro ao gerar imagem do QR Code:", err);
        res.status(500).send('Erro ao gerar o QR Code.');
      }
    } else {
      res.status(404).send(`
        <!DOCTYPE html><html><head><title>Status</title><meta http-equiv="refresh" content="7"></head>
        <body style="font-family:sans-serif;text-align:center;padding-top:50px;">
        <h1>QR Code não disponível.</h1>
        <p>O bot pode já estar conectado ou aguardando para gerar um novo código.</p>
        <p>Esta página será atualizada automaticamente.</p></body></html>
      `);
    }
  });

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 API do bot rodando na porta ${PORT}`);
  });
}

startSock();
