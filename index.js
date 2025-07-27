// index.js (com melhorias anti-spam)
const makeWASocket = require("@whiskeysockets/baileys").default;
const {
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason,
} = require("@whiskeysockets/baileys");
const P = require("pino");
const dotenv = require("dotenv");
const { Boom } = require("@hapi/boom");
const qrcode = require("qrcode-terminal");
const express = require("express");
const { createClient } = require("@supabase/supabase-js");

dotenv.config();
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// --- Fila de Notificações Anti-Spam ---
const notificationQueue = [];
let isProcessingQueue = false;

// Função que processa a fila com atraso
async function processQueue(sock) {
    if (isProcessingQueue || notificationQueue.length === 0) {
        return;
    }
    isProcessingQueue = true;

    const job = notificationQueue.shift(); // Pega o primeiro item da fila

    try {
        await sock.sendMessage(job.recipient, { text: job.message });
        console.log(`✅ Notificação enviada para ${job.recipient}`);
    } catch (e) {
        console.error(`❌ Falha ao enviar notificação para ${job.recipient}:`, e);
    }
    
    // Define um atraso aleatório entre 7 e 20 segundos para a próxima mensagem
    const delay = Math.floor(Math.random() * (20000 - 7000 + 1)) + 7000;
    console.log(`[Anti-Spam] Aguardando ${delay / 1000} segundos para a próxima mensagem...`);
    
    setTimeout(() => {
        isProcessingQueue = false;
        processQueue(sock); // Tenta processar o próximo item
    }, delay);
}


async function startSock() {
    // ... (código de conexão do Baileys, sem alterações) ...
    const { state, saveCreds } = await useMultiFileAuthState("auth");
    const { version } = await fetchLatestBaileysVersion();
    const sock = makeWASocket({
        version,
        logger: P({ level: "silent" }),
        auth: state,
        printQRInTerminal: true,
    });

    startApiServer(sock);

    sock.ev.on("connection.update", (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === "close") {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log("🔌 Conexão encerrada. Tentando reconectar:", shouldReconnect);
            if (shouldReconnect) {
                startSock();
            }
        } else if (connection === "open") {
            console.log("✅ Bot conectado com sucesso ao WhatsApp.");
            // Inicia o processador da fila assim que o bot estiver conectado
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
            if (error || !aluno) {
                return res.status(404).send('Aluno não encontrado.');
            }
            if (!aluno.telefone_responsavel || !aluno.nome_responsavel) {
                return res.status(400).send('Dados do responsável incompletos.');
            }

            // --- Lógica de Variação de Mensagem (Spintax) ---
            const dataFormatada = new Date(dataFalta).toLocaleDateString('pt-BR', { timeZone: 'UTC' });
            const templates = [
                `Olá, ${aluno.nome_responsavel}. Gostaríamos de informar que o(a) aluno(a) ${aluno.nome} não compareceu à aula hoje, dia ${dataFormatada}.`,
                `Prezado(a) ${aluno.nome_responsavel}, identificamos a ausência do(a) estudante ${aluno.nome} na data de ${dataFormatada}.`,
                `Atenção, ${aluno.nome_responsavel}. Comunicamos a falta do(a) aluno(a) ${aluno.nome} no dia ${dataFormatada}. Por favor, entre em contato com a escola se necessário.`,
            ];
            const mensagem = templates[Math.floor(Math.random() * templates.length)];
            const numeroResponsavel = `${aluno.telefone_responsavel}@s.whatsapp.net`;
            
            // Adiciona a notificação à fila em vez de enviar diretamente
            notificationQueue.push({ recipient: numeroResponsavel, message: mensagem });
            console.log(`[Fila] Notificação para o responsável por ${aluno.nome} adicionada à fila.`);
            
            // Inicia o processamento da fila, caso ela estivesse vazia
            processQueue(sock);

            res.status(200).send('Notificação enfileirada para envio.');
        } catch (err) {
            console.error("❌ Erro no endpoint /notificar-falta:", err);
            res.status(500).send('Erro interno no servidor do bot.');
        }
    });

    app.listen(PORT, '0.0.0.0', () => {
        console.log(`🚀 Servidor de API do bot rodando na porta ${PORT}`);
    });
}

startSock();