// handlerCadastroResponsavel.js
const dotenv = require("dotenv");
dotenv.config();

const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// Armazena o progresso da conversa para cada usuário.
const conversas = {};

function limparNumero(numero) {
  return numero.replace(/\D/g, "");
}

async function handleCadastroResponsavel(sock, msg) {
  try {
    const sender = msg.key.remoteJid;
    const body = msg.message.conversation || msg.message.extendedTextMessage?.text || "";

    const estado = conversas[sender];

    // --- Bloco 1: Comando para INICIAR a conversa ---
    // Este bloco só é executado se NÃO houver uma conversa em andamento.
    if (body.toLowerCase().includes("cadastrar telefone") && !estado) {
      console.log(`[${sender}] Iniciando fluxo de cadastro...`);
      
      const idDaEscola = "7c178689-1047-4a4d-8820-58ebea901462";
      const { data: turmas, error } = await supabase
        .from("turmas")
        .select("id, nome")
        .eq("escola_id", idDaEscola);

      if (error) {
        console.error("Erro ao buscar turmas:", error);
        await sock.sendMessage(sender, { text: "Ocorreu um erro ao consultar as turmas." });
        return; // Para a execução
      }

      if (!turmas || turmas.length === 0) {
        await sock.sendMessage(sender, { text: "Nenhuma turma foi encontrada para a escola configurada." });
        return; // Para a execução
      }

      // Inicia o estado da conversa
      conversas[sender] = {
        etapa: "aguardando_turma",
        turmas: turmas,
        dados: {},
      };

      const lista = turmas.map((t) => t.nome).join("\n");
      await sock.sendMessage(sender, {
        text: `Olá! Vamos cadastrar um responsável.\n\nInforme o nome EXATO de uma das turmas abaixo. Para cancelar, digite "cancelar" a qualquer momento.\n\n${lista}`,
      });
      
      return; // ESSENCIAL: Para e espera a resposta do usuário.
    }
    
    // --- Bloco 2: Comando para CANCELAR a conversa ---
    if (body.toLowerCase() === "cancelar") {
      if (estado) {
        delete conversas[sender];
        await sock.sendMessage(sender, { text: "Operação cancelada com sucesso." });
      }
      return;
    }

    // --- Bloco 3: Processamento dos ESTADOS da conversa ---
    // Se não houver uma conversa ativa, não faz nada.
    if (!estado) {
      return;
    }

    // Agora, usamos 'else if' para garantir que apenas uma etapa seja processada.
    if (estado.etapa === "aguardando_turma") {
      const turma = estado.turmas.find((t) => t.nome.toLowerCase() === body.toLowerCase());
      if (!turma) {
        await sock.sendMessage(sender, { text: "Turma não encontrada. Por favor, digite o nome exato de uma das turmas da lista ou digite 'cancelar'." });
        return;
      }

      estado.dados.turma_id = turma.id;
      estado.etapa = "aguardando_aluno";

      const { data: alunos } = await supabase.from("alunos").select("id, nome").eq("turma_id", turma.id);

      if (!alunos || alunos.length === 0) {
        await sock.sendMessage(sender, { text: "Nenhum aluno encontrado nessa turma. A operação foi encerrada." });
        delete conversas[sender];
        return;
      }

      estado.alunos = alunos;
      const lista = alunos.map((a, i) => `${i + 1}. ${a.nome}`).join("\n");
      await sock.sendMessage(sender, { text: `Ótimo! Agora, escolha o NÚMERO do aluno:\n\n${lista}` });
      return; // Para e espera a próxima resposta

    } else if (estado.etapa === "aguardando_aluno") {
      const index = parseInt(body);
      if (isNaN(index) || index < 1 || index > estado.alunos.length) {
        await sock.sendMessage(sender, { text: "Número inválido. Por favor, envie apenas o número correspondente ao aluno." });
        return;
      }

      estado.dados.aluno = estado.alunos[index - 1];
      estado.etapa = "aguardando_nome_responsavel";

      await sock.sendMessage(sender, { text: `Perfeito. Agora, informe o nome completo do responsável por ${estado.dados.aluno.nome}:` });
      return; // Para e espera

    } else if (estado.etapa === "aguardando_nome_responsavel") {
      estado.dados.nome_responsavel = body;
      estado.etapa = "aguardando_telefone_responsavel";

      await sock.sendMessage(sender, { text: "Estamos quase lá. Agora, informe o telefone do responsável (com DDD):" });
      return; // Para e espera

    } else if (estado.etapa === "aguardando_telefone_responsavel") {
      const numeroLimpo = limparNumero(body);
      if (numeroLimpo.length < 10 || numeroLimpo.length > 13) {
        await sock.sendMessage(sender, { text: "Número de telefone inválido. Tente novamente (incluindo o DDD)." });
        return;
      }

      const alunoId = estado.dados.aluno.id;
      const { error } = await supabase
        .from("alunos")
        .update({
          nome_responsavel: estado.dados.nome_responsavel,
          telefone_responsavel: numeroLimpo,
        })
        .eq("id", alunoId);

      if (error) {
        await sock.sendMessage(sender, { text: "❌ Ocorreu um erro ao salvar os dados. Tente novamente mais tarde." });
      } else {
        await sock.sendMessage(sender, { text: `✅ Sucesso! Responsável cadastrado para o aluno(a) ${estado.dados.aluno.nome}.` });
      }

      // Finaliza a conversa
      delete conversas[sender];
      return;
    }

  } catch (error) {
    console.error("ERRO CRÍTICO no handleCadastroResponsavel:", error);
    const sender = msg?.key?.remoteJid;
    if (sender && conversas[sender]) {
      // Limpa o estado da conversa em caso de erro para não travar o usuário
      delete conversas[sender];
      await sock.sendMessage(sender, { text: "❌ Ocorreu um erro inesperado e a operação foi cancelada. Tente novamente." });
    }
  }
}

module.exports = handleCadastroResponsavel;