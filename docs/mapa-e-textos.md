# ComparaCam — Mapa do app e textos (para revisão jurídica) — v7.0

Documento para revisão dos textos com o jurídico. Cada seção traz **onde o texto
aparece** e o **texto exato** exibido ao usuário. Anote os ajustes desejados ao lado de
cada item; depois aplicamos no app.

---

## 🗺️ Mapa mental (visão geral)

```
ComparaCam (PWA)
│
├─ 1. LOGIN (tela de acesso — 1ª coisa que aparece)
│    ├─ Passo 1: e-mail → "Enviar código"
│    ├─ Passo 2: código de 6 dígitos → "Entrar" (aviso de spam)
│    └─ Rodapé: Termos de uso · Política de Privacidade
│
├─ 2. INÍCIO (lista de comparações)
│    ├─ Barra: saldo de créditos + "Adquirir"  |  ⚙ Administração (só admin)  |  👤 Perfil
│    ├─ Estado vazio: "Nenhuma comparação ainda…"
│    └─ Botão: "Nova comparação"
│         ├─ Popup: "Suas comparações ficam só neste aparelho" (☑ não mostrar)
│         ├─ Popup: "Você vai precisar de 2 fotos" (☑ não mostrar)
│         └─ Popup: "Como escolher a foto base?" (Tirar / Importar)
│
├─ 3. CÂMERA (Ghost Overlay)
│    ├─ Título: "Foto base" / "Acompanhamento"
│    ├─ Controles: Fantasma, Brilho, Contraste, Saturação, Lanterna
│    ├─ Dica: "Mantenha 40–60 cm do local"
│    └─ Popup pós-captura: "Rótulo da foto" (+ consentimento do paciente na base nova)
│         └─ Popup: "Foto base salva ✓ — agora o acompanhamento" (☑ não mostrar)
│
├─ 4. ALINHAR ACOMPANHAMENTO
│    └─ "Arraste para posicionar • pince para dar zoom" + Alinhamento automático
│
├─ 5. MONTAGEM (detalhe da comparação)
│    ├─ Cortina / Lado a lado / Sobrepor
│    ├─ Rótulos no rodapé (Base / Acompanhamento)
│    ├─ Refazer/Importar base e acompanhamento
│    ├─ Ajustar imagens · Reposicionar · 🔁 Trocar base↔acomp.
│    └─ "Comparar" → aviso "Concluir comparação" → "Gerar comparação" (salvar/compartilhar)
│
├─ 6. AJUSTE DE IMAGENS (editor)
│    └─ Ajuste Relativo/Absoluto, travar as 2 imagens, sliders
│
├─ 7. PERFIL (👤)
│    ├─ Conta (e-mail) · Sair · Trocar perfil · 💾 Backup · Termos · Privacidade
│    └─ Marca d'água (nome, logo, posição, transparência, fonte, data)
│
├─ 8. ADQUIRIR CRÉDITOS
│    └─ Resgatar voucher (digitar ou 📷 ler QR)
│
├─ 9. ADMINISTRAÇÃO (só admin ⚙)
│    ├─ Preço por crédito + moeda
│    ├─ QR de instalação (convite Android/iPhone)
│    ├─ Criar grupo de vouchers (+ vídeo do patrocinador)
│    └─ Grupos criados: Ver códigos · QR codes · Relatório (CSV) · Desativar · Excluir
│
├─ 10. VÍDEO DO PATROCINADOR (obrigatório após resgatar voucher)
│
├─ 11. BACKUP / RESTAURAÇÃO das comparações
│
├─ 12. TERMOS DE USO E LICENÇA
└─ 13. POLÍTICA DE PRIVACIDADE (LGPD)
```

---

## 1. Tela de LOGIN

**Título:** ComparaCam
**Passo 1 (subtítulo):** "Entre com seu e-mail. Enviaremos um código de acesso — sem senha."
- Campo: **E-mail** (placeholder "voce@exemplo.com")
- Botão: **Enviar código**

**Passo 2 (subtítulo):** "Digite o código enviado para _[e-mail]_."
- Campo: **Código** (placeholder "000000")
- Botão: **Entrar**
- Botão: **Trocar e-mail / reenviar**
- Aviso: "Não chegou? O e-mail pode levar alguns instantes — verifique também a **caixa de spam**."

**Rodapé:** "Ao entrar, você concorda com os **Termos de uso** e a **Política de Privacidade**."

---

## 2. Tela INÍCIO

- Título da barra: **ComparaCam**
- Saldo: "🪙 _N_ créditos" + botão **Adquirir**
- Botões de topo: ⚙ **Administração** (só admin) · 👤 **Perfil**
- **Estado vazio:**
  - Título: "Nenhuma comparação ainda"
  - Texto: "Toque em \"Nova comparação\" para registrar a primeira foto (tirar ou importar). Na próxima consulta, use o Ghost Overlay para tirar a foto de acompanhamento no mesmo enquadramento."
- Botão inferior: **➕ Nova comparação**

**Popup "só neste aparelho":**
- Título: "Suas comparações ficam só neste aparelho"
- Texto: "As fotos e comparações são salvas **apenas neste dispositivo**. Elas não vão para a nuvem e **não podem ser abertas em outro aparelho**. Se você desconectar a conta ou limpar o aplicativo, elas **não poderão ser recuperadas**."
- ☑ "Não mostrar novamente" · Botão **Entendi**

**Popup "2 fotos":**
- Título: "Você vai precisar de 2 fotos"
- Texto: "Uma comparação usa **duas fotos**: a **base** (o \"antes\") e a de **acompanhamento** (o \"depois\"). Comece pela **foto base** agora. Na próxima consulta, use o **Ghost Overlay** para tirar a foto de acompanhamento no mesmo enquadramento."
- ☑ "Não mostrar novamente" · Botão **Entendi**

**Popup "Nova comparação":**
- Título: "Nova comparação"
- Pergunta: "Como você quer escolher a foto base?"
- Botões: **📷 Tirar nova foto** · **🖼 Importar da galeria** · **Fechar**

---

## 3. Tela CÂMERA (Ghost Overlay)

- Título: "Foto base" ou "Acompanhamento"
- Controles (sliders): **Fantasma**, **Brilho**, **Contraste**, **Saturação**; botão **🔦 Lanterna**
- Dica: "Mantenha 40–60 cm do local"
- Início da câmera: "▶ Toque para iniciar a câmera"

**Popup "Rótulo da foto":**
- Título: "Rótulo da foto"
- Campo: "Rótulo (rodapé da foto)" (placeholder "Ex.: Perna direita")
- Consentimento (só ao criar comparação nova): ☑ "Confirmo que tenho o **consentimento do paciente** para registrar e usar estas imagens."
- Botões: **Refazer** · **Salvar**

**Popup "acompanhamento" (após salvar a base):**
- Título: "Foto base salva ✓"
- Texto: "Agora falta a **foto de acompanhamento** (o \"depois\"). Você pode tirá-la mais tarde — na próxima consulta, abra esta comparação e use **Refazer/Tirar** ou **Importar acompanhamento**, com o **Ghost Overlay** ajudando a repetir o mesmo enquadramento."
- ☑ "Não mostrar novamente" · Botão **Entendi**

---

## 4. Tela ALINHAR ACOMPANHAMENTO

- Título: "Alinhar acompanhamento"
- Dica: "Arraste para posicionar • pince para dar zoom"
- Botão: **✨ Alinhamento automático**
- Sliders: **Zoom**, **Girar**, **Fantasma**

---

## 5. Tela MONTAGEM (detalhe)

- Título: "Montagem"
- Modos: **Cortina** · **Lado a lado** · **Sobrepor**
- Card de rótulo: ☑ "Mostrar rótulo no rodapé das fotos"; campos "Rótulo da foto base" e "Rótulo do acompanhamento"
- Cards de foto: **Base** (📷 Refazer / 🖼 Importar) · **Acompanhamento** (📷 Tirar/Refazer / 🖼 Importar)
- Botões: **🎚 Ajustar imagens** · **↔️ Reposicionar imagens** · **🔁 Trocar base ↔ acompanhamento** · **🔀 Comparar**
- Quando concluída: "🔒 Comparação concluída — as fotos não podem mais ser alteradas."

**Popup "Concluir comparação":**
- Título: "Concluir comparação"
- Texto: "Ao salvar, **as fotos não poderão mais ser alteradas para esta comparação.**"
- ☑ "Não avisar mais isso" · Botões **Cancelar** / **Salvar**

**Popup "Gerar comparação" (salvar/compartilhar):**
- Título: "Gerar comparação"
- Dica: "No iPhone: escolha **Salvar em Fotos** (galeria) ou **Salvar em Arquivos** (iCloud, Google Drive, OneDrive, Dropbox)."
- Categorias: **📷 Foto** (Salvar fotos separadas / Comparação lado a lado) · **🎬 Vídeo** (Cortina / Sobrepostos)

**Popup "Mídia salva":** "Foto salva!" / "Vídeo salvo!" + **OK**

---

## 6. Tela AJUSTE DE IMAGENS (editor)

- Título: "Ajuste de imagens"; rótulos "Base" / "Acompanhamento"
- Botões: **Ajuste Relativo** · **Ajuste Absoluto** · **Zerar ajustes** · ☑ "Travar as 2 imagens"
- Dica: "Absoluto: mesmos valores nas duas fotos. Relativo: ajustes (±) próprios de cada foto. Travar: mexer numa altera a outra igual."
- "Editando:" **Base** / **Acompanhamento** + sliders de ajuste

---

## 7. Tela PERFIL

- Título: "Perfil"
- "Conta: _[e-mail]_" · botões **Sair** / **Trocar perfil**
- **💾 Backup das comparações**
- Links: **Termos de uso** · **Política de Privacidade**
- Seção: "Características da marca d'água" — Nome, Fonte, Tamanho, Logo (Escolher imagem/Remover), "Posição na foto (arraste a logo e o nome; alça da logo p/ redimensionar)", ☑ "Mostrar logo nas fotos", ☑ "Mostrar nome nas fotos", Transparência, "Fonte do rodapé", "Data automática no rótulo" (Não incluir / Somente data / Data e hora)
- Botões: **Cancelar** / **Salvar**

**Popup "Sair":** "Sair do aplicativo? Ele será desabilitado neste aparelho até um novo login."
**Popup "Trocar perfil":** "Trocar de perfil? Você vai sair desta conta."
**Popup "Descartar alterações?":** "Há alterações não salvas no perfil." — **Continuar editando** / **Descartar**

---

## 8. Popup ADQUIRIR CRÉDITOS

- Título: "Adquirir créditos"
- "Seu saldo: _N_ créditos"
- "Resgatar voucher" (campo + botão **Resgatar**) · **📷 Ler QR code do voucher**
- Nota: "Cada comparação consome 1 crédito. A compra avulsa (Mercado Pago) entra em breve — por enquanto, adicione créditos resgatando um voucher."

**Popup "Ler QR code":** "Aponte a câmera para o QR code do voucher"

---

## 9. Popup ADMINISTRAÇÃO (só admin)

- Título: "Administração"
- "Preço por crédito" (moeda + valor + **Salvar**)
- **📇 QR de instalação (convite)**
- "Criar grupo de vouchers": Nome do grupo, Créditos por voucher, Quantidade, Vídeo do patrocinador, Pré-código, Validade em dias → **Gerar vouchers**
- "Grupos criados": por grupo → **Ver códigos** · **QR codes** · **Relatório** · **Desativar** · **Excluir**

**QR de instalação (convite):**
- iPhone/iPad: "Abra o QR no Safari" → "Toque em \"…\" (reticências) no canto inferior direito e escolha Compartilhar" → "Toque em Adicionar à Tela de Início e confirme em Adicionar."
- Android: "Abra o QR no Chrome" → "Toque em Instalar (ou menu ⋮ → Instalar app)" → "Confirme para colocar na tela inicial."

**QR codes dos vouchers:** "O médico lê o QR **dentro do app**: Adquirir créditos → \"Ler QR code\". Só aparecem os vouchers **ainda não resgatados**. Baixe os PNGs para enviar ao contratante gerar os vouchers físicos."

**Relatório de vouchers:** tabela Código · E-mail · Resgatado em · Status + **⬇️ Baixar CSV**

---

## 10. VÍDEO DO PATROCINADOR (obrigatório)

- Cabeçalho: "Vídeo do patrocinador"
- Placeholder: "ComparaCam / Espaço do patrocinador"
- Botões (habilitam ao fim): **Rever** · **Sair**

---

## 11. Popup BACKUP DAS COMPARAÇÕES

- Título: "Backup das comparações"
- Texto: "Suas comparações ficam na **memória temporária do aplicativo** neste aparelho. Faça um backup para não perdê-las ao trocar de aparelho, limpar o app ou desconectar. Guarde o backup em um diretório do seu dispositivo ou na sua nuvem — depois é só restaurar aqui."
- **Salvar backup** · "Restaurar de um arquivo de backup" · **Fechar**

---

## 12. Banner e popup do SAFARI (instalação no iPhone)

**Banner:** "Instalar o ComparaCam" / "Toque em \"Ver como\" para usar como app." + botão **Ver como**

**Popup:**
- Título: "Use como app — não perca suas comparações"
- Aviso: "Você está no **Safari**. Aqui as comparações podem **ser perdidas** se você abrir o app em outra aba/janela ou o navegador limpar os dados. Adicione à **Tela de Início** para usar como aplicativo e manter tudo salvo:"
- Passos: (1) "Toque em \"…\" (reticências) no canto inferior direito do Safari e escolha Compartilhar" (2) "Role e toque em Adicionar à Tela de Início" (3) "Toque em Adicionar, no canto superior direito." · **Entendi**

---

## 13. TERMOS DE USO E LICENÇA — ComparaCam
*(texto integral exibido no app — REVISAR)*

**1. Objeto.** O ComparaCam é um aplicativo para captura e comparação padronizada de fotografias (antes/depois), destinado ao uso por profissionais de saúde no acompanhamento clínico. O uso do aplicativo implica a aceitação integral destes termos.

**2. Armazenamento apenas no dispositivo.** Todas as fotos e comparações são gravadas **exclusivamente no aparelho** em que foram criadas. O aplicativo **não envia essas imagens para nenhum servidor ou nuvem**. Em consequência:
- as comparações **não podem ser acessadas de outro aparelho**;
- se você **desconectar a conta**, trocar de perfil, limpar os dados do aplicativo, remover o app ou perder o aparelho, as comparações **serão perdidas e não poderão ser recuperadas**;
- a responsabilidade por manter cópias/backup das imagens, quando necessário, é exclusivamente do usuário, por meio das funções de exportar/salvar.

**3. Conta e créditos.** O acesso é feito por e-mail (código de uso único). Os créditos e vouchers vinculados à conta são pessoais e intransferíveis. A conta serve para liberar o uso e gerir créditos — **ela não guarda suas fotos**.

**4. Responsabilidade do profissional.** O usuário é o único responsável pelo uso clínico das imagens, pela obtenção do **consentimento do paciente**, pela guarda e sigilo dos dados e pelo cumprimento das normas aplicáveis (incluindo a LGPD e as regras do conselho profissional). O aplicativo é uma ferramenta de apoio e não substitui o julgamento clínico.

**5. Garantias.** O software é fornecido "no estado em que se encontra", sem garantia de disponibilidade contínua ou ausência de falhas. Na máxima extensão permitida em lei, os fornecedores não respondem por perda de imagens decorrente das características descritas no item 2.

**6. Alterações.** Estes termos podem ser atualizados. O uso continuado após a atualização representa concordância com a nova versão.

> _Nota no app:_ "Este texto é um modelo inicial e deve ser revisado por um profissional jurídico antes do uso comercial."

**Pontos para o jurídico avaliar:** foro/legislação aplicável; identificação da empresa/CNPJ e contato; propriedade intelectual; regras de reembolso/cancelamento de créditos; limitação de responsabilidade; publicidade médica (CFM/Anvisa) e patrocínio; menoridade/pacientes; retenção e descarte.

---

## 14. POLÍTICA DE PRIVACIDADE — ComparaCam (LGPD)
*(texto integral exibido no app — REVISAR)*

**Resumo:** as fotos e comparações dos pacientes ficam **apenas no seu aparelho** e **não são enviadas** a nenhum servidor. No servidor guardamos somente o necessário para a conta e os créditos.

**1. Dados no aparelho.** Imagens, rótulos e comparações são gravados só no dispositivo (armazenamento local do navegador). O desenvolvedor não tem acesso a eles. Backups gerados por você ficam sob sua guarda.

**2. Dados no servidor (Supabase).** Tratamos apenas: seu **e-mail** (login por código, sem senha), o **saldo de créditos**, o histórico de créditos e os **vouchers** resgatados. Nenhuma imagem de paciente é enviada.

**3. Base legal e finalidade (LGPD).** Os dados de conta são tratados para permitir o acesso e a gestão de créditos (execução do serviço). As imagens de pacientes são tratadas **por você**, profissional de saúde, sob sua responsabilidade e base legal próprias (consentimento do paciente e/ou tutela da saúde), permanecendo no seu aparelho.

**4. Consentimento do paciente.** Ao criar uma comparação, você confirma ter o consentimento do paciente para registrar e usar as imagens. Guarde esse consentimento conforme suas obrigações profissionais.

**5. Compartilhamento.** Não vendemos nem compartilhamos seus dados. O envio de e-mails de acesso usa um provedor de e-mail; o backend usa o Supabase. As imagens que você exporta/compartilha vão para onde você escolher (Fotos, Arquivos, etc.).

**6. Direitos do titular.** Você pode solicitar acesso, correção ou exclusão dos dados de conta pelo e-mail de contato. A exclusão da conta remove saldo e histórico do servidor; as imagens, por ficarem no aparelho, são apagadas por você.

**7. Segurança.** Acesso por código de uso único; saldo protegido por regras no servidor; as imagens nunca trafegam para a nuvem por padrão.

> _Nota no app:_ "Modelo inicial — revise com um profissional jurídico e inclua o e-mail de contato do responsável (encarregado/DPO) antes do uso comercial."

**Pontos para o jurídico avaliar:** identificação do **controlador** (empresa/CNPJ) e do **encarregado/DPO** com e-mail de contato; base(s) legal(is) da LGPD para cada dado; transferência internacional (Supabase/servidores fora do Brasil — art. 33 LGPD); provedor de e-mail (subprocessador); prazo de retenção; cookies/armazenamento local; enquadramento de **dado sensível de saúde** e responsabilidade do profissional como controlador das imagens.

---

*Como usar este documento: marque em cada item o que deseja alterar (ou reescreva o texto ao lado). Depois eu aplico as mudanças no app e publicamos uma nova versão.*
