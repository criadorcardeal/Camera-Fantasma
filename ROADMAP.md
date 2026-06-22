# Roadmap — Fotos Fantasma

## Versão 1.0 (atual) — Gratuita ✅

App web (PWA) para fotos comparativas em angiologia, com Ghost Overlay.
Roda no Safari (iPhone) e Chrome; instalável via "Adicionar à Tela de Início".

- **Ghost Overlay** — a foto base aparece sobreposta (opacidade ajustável)
  sobre a câmera ao vivo, para alinhar a 2ª foto no mesmo enquadramento.
- **Lanterna/flash contínuo** — onde o navegador permite (Android/Chrome);
  no iOS/Safari fica indisponível (limitação da Apple) — usar luz natural/branca.
- **Registro de distância** — confirmação ao salvar; a 2ª foto mostra a
  distância-alvo da base (guia 40–60 cm).
- **Ajuste de imagem na captura** — brilho/contraste/saturação são gravados na
  foto e reaplicados na foto de acompanhamento.
- **Comparação antes/depois** — cortina deslizante, lado a lado ou sobreposição.
- **Importar foto base** — da galeria do aparelho ou da nuvem (iCloud, Google
  Drive, OneDrive, Dropbox) pelo seletor de arquivos do iOS.
- Armazenamento **local** (IndexedDB), sem nuvem.

---

## Versão 2.0 (planejada) 🔜

### 1. Importar a foto de acompanhamento ✅ (implementada)
Botão **"🖼 Importar acompanhamento"** na tela de comparação — usa a galeria ou
a nuvem (via app Arquivos do iOS), além de tirá-la pela câmera.

### 2. Salvar/baixar fotos e a comparação
Exportar para a **galeria do aparelho** e/ou **nuvem** (Google Drive, OneDrive,
Dropbox, iCloud):
- cada foto (base e acompanhamento) individualmente;
- a **imagem da comparação** (antes/depois montado).

### 3. Janela de controle das características das imagens ✅ (implementada)
Uma janela dedicada para ajustar a aparência das imagens.
Acesse pelo botão **"🎚 Ajustar imagens"** na tela de comparação (quando há base
e acompanhamento). Não-destrutivo: guarda os valores e uma versão renderizada;
o original fica intacto para reedição.

**a) Ajuste manual individualizado** de cada característica, por imagem:
- Exposição
- Contraste
- Altas-luzes (highlights)
- Sombras (shadows)
- Saturação
- Temperatura
- Tonalidade (tint)
- Nitidez (sharpness)

**b) Botão "Ajuste Automático Completo"**
Define, **nas duas imagens**, **todas** as características com o **valor médio
entre os valores iniciais de cada imagem**. Ou seja: mede o valor inicial de
cada característica em cada foto, calcula a média entre as duas e aplica esse
mesmo valor médio às duas — deixando as imagens com aparência harmonizada.

**c) Toggle on/off "Travar características das duas imagens"**
- **ON**: ao mexer em uma característica de uma das imagens, a **mesma**
  característica da outra imagem muda **igual** (em conjunto).
- **OFF**: os ajustes de cada imagem são **independentes** (mexer em uma não
  altera a outra).

> Notas técnicas (para implementação): exposição/contraste/saturação são
> diretos via canvas/`ctx.filter`. Altas-luzes, sombras, temperatura,
> tonalidade e nitidez exigem processamento por pixel (ou WebGL/shaders). O
> "valor inicial" de cada imagem precisa ser **estimado** analisando a foto
> (ex.: luminância média, desvio para contraste, saturação média, dominante de
> cor para temperatura/tonalidade) antes de calcular a média entre as duas.

---

## Versão paga (futuro)

- Armazenar foto com **nome e código**.
- **Banco de dados separado** por grupo de fotos do mesmo objeto.
- Exportar grupos para **animações antes/depois**.
- **Sugestões de posições** de pés e pernas (as 8 posições do guia do
  consultório).
- Possível integração **direta** com cada nuvem (login próprio Google Drive /
  OneDrive / Dropbox via OAuth).
