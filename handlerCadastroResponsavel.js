const { supabase } = require("../supabaseClient");
const { turmasDisponiveis } = require("../utils/turmas");
const { isValidPhoneNumber } = require("../utils/validators");

async function handlerCadastroResponsavel(socket, msg) {
  const numeroUsuario = msg.key.remoteJid.replace("@s.whatsapp.net", "");
  const mensagemTexto = msg.message.conversation || msg.message.extendedTextMessage?.text;

  const { data: conversa, error: erroConversa } = await supabase
    .from("conversas")
    .select("*")
    .eq("numero", numeroUsuario)
    .single();

  let etapa = conversa?.etapa || "inicio";

  if (etapa === "inicio") {
    await socket.sendMessage(msg.key.remoteJid, {
      text: "👋 Olá! Vamos iniciar o cadastro do responsável.\n\nPor favor, informe o *nome completo* do responsável:",
    });

    await supabase
      .from("conversas")
      .upsert({ numero: numeroUsuario, etapa: "aguardando_nome" });

    return;
  }

  if (etapa === "aguardando_nome") {
    const nomeResponsavel = mensagemTexto.trim();

    await supabase
      .from("responsaveis")
      .upsert({ numero: numeroUsuario, nome_responsavel: nomeResponsavel });

    await socket.sendMessage(msg.key.remoteJid, {
      text: "✅ Nome salvo com sucesso!\n\nAgora envie o *número de telefone do responsável* (com DDD):",
    });

    await supabase
      .from("conversas")
      .update({ etapa: "aguardando_telefone" })
      .eq("numero", numeroUsuario);

    return;
  }

  if (etapa === "aguardando_telefone") {
    const telefone = mensagemTexto.replace(/\D/g, "");

    if (!isValidPhoneNumber(telefone)) {
      await socket.sendMessage(msg.key.remoteJid, {
        text: "❌ Número inválido. Envie um número de telefone válido com DDD (ex: 81999999999):",
      });
      return;
    }

    await supabase
      .from("responsaveis")
      .update({ telefone_responsavel: telefone })
      .eq("numero", numeroUsuario);

    await socket.sendMessage(msg.key.remoteJid, {
      text: "📚 Agora informe a *turma do aluno*. Escolha uma das opções abaixo:",
    });

    const turmas = await turmasDisponiveis();

    if (!turmas || turmas.length === 0) {
      await socket.sendMessage(msg.key.remoteJid, {
        text: "⚠️ Nenhuma turma disponível no momento. Tente novamente mais tarde.",
      });
      return;
    }

    const botoesTurmas = turmas.map((turma, index) => ({
      buttonId: `turma_${turma.id}`,
      buttonText: { displayText: turma.nome },
      type: 1,
    }));

    await socket.sendMessage(msg.key.remoteJid, {
      text: "Selecione a turma:",
      buttons: botoesTurmas,
      headerType: 1,
    });

    await supabase
      .from("conversas")
      .update({ etapa: "aguardando_turma" })
      .eq("numero", numeroUsuario);

    return;
  }

  if (etapa === "aguardando_turma") {
    const turmaSelecionada = mensagemTexto.trim();

    const turmas = await turmasDisponiveis();
    const turmaValida = turmas.find((t) => t.nome.toLowerCase() === turmaSelecionada.toLowerCase());

    if (!turmaValida) {
      await socket.sendMessage(msg.key.remoteJid, {
        text: "❌ Turma não encontrada. Por favor, digite exatamente como aparece na lista.",
      });
      return;
    }

    await supabase
      .from("responsaveis")
      .update({ turma: turmaValida.nome })
      .eq("numero", numeroUsuario);

    await socket.sendMessage(msg.key.remoteJid, {
      text: `✅ Cadastro finalizado com sucesso!\n\nResponsável registrado na turma *${turmaValida.nome}*.`,
    });

    await supabase
      .from("conversas")
      .update({ etapa: "finalizado" })
      .eq("numero", numeroUsuario);

    return;
  }

  if (etapa === "finalizado") {
    await socket.sendMessage(msg.key.remoteJid, {
      text: "✅ O cadastro já foi finalizado. Caso deseje reiniciar, envie *reiniciar*.",
    });
    return;
  }

  if (mensagemTexto?.toLowerCase() === "reiniciar") {
    await supabase
      .from("conversas")
      .update({ etapa: "inicio" })
      .eq("numero", numeroUsuario);

    await socket.sendMessage(msg.key.remoteJid, {
      text: "🔄 Cadastro reiniciado. Vamos começar novamente.\n\nInforme o *nome completo* do responsável:",
    });

    await supabase
      .from("conversas")
      .update({ etapa: "aguardando_nome" })
      .eq("numero", numeroUsuario);

    return;
  }

  // Fallback genérico
  await socket.sendMessage(msg.key.remoteJid, {
    text: "❓ Desculpe, não entendi sua mensagem. Por favor, siga as instruções do cadastro.",
  });
}

module.exports = handlerCadastroResponsavel;
