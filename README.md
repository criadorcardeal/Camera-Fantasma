# Fotos Fantasma

App de fotos comparativas para angiologia, com **Ghost Overlay**. Esta é a
**versão gratuita inicial**.

Pensado para padronizar fotos de acompanhamento de pernas e pés (consultório
Dr. Ricardo Lacerda): você tira a foto base e, na consulta seguinte, o app
sobrepõe a foto anterior (fantasma) na tela para alinhar a nova foto no mesmo
enquadramento, distância e iluminação.

## O que a versão gratuita faz

- **Ghost Overlay** – a foto base aparece sobreposta (com opacidade ajustável)
  sobre a câmera ao vivo, para alinhar a 2ª foto.
- **Lanterna/flash contínuo** – luz ligada durante o posicionamento **e** a
  foto (e dá para desligar com um toque).
- **Registro da distância** – ao salvar a foto base você confirma a distância
  (guia 40–60 cm). Na foto de acompanhamento o app mostra essa **distância-alvo**
  para você repetir.
- **Mesmos parâmetros de imagem** – na 2ª foto o app reaplica os parâmetros da
  base (exposição travada + ajuste, zoom e flash) para deixar as imagens
  semelhantes.
- **Comparação antes/depois** – cortina deslizante, lado a lado ou sobreposição.
- **Importar foto base** – usar uma foto já existente como base do Ghost Overlay,
  vinda da galeria do aparelho ou da nuvem (pelo app Arquivos do iOS: iCloud
  Drive, Google Drive, OneDrive, Dropbox, se instalados).

As fotos ficam **somente no aparelho** (sem nuvem). Nome/código, banco por
objeto e animações antes/depois são da **versão paga** (próxima fase).

> Sobre a distância "automática": a estimativa por sensor (distância de foco /
> profundidade) exige código nativo testado em aparelho real e será ativada
> numa próxima build com teste no celular. Por enquanto a distância é
> confirmada manualmente e a igualdade real entre as fotos é garantida pelo
> Ghost Overlay (mesmo enquadramento = mesma distância).

---

## Como gerar o APK (build na nuvem, sem instalar nada pesado)

O projeto já vem com um fluxo do **GitHub Actions** que compila o APK na nuvem.
Você só precisa de uma conta gratuita no GitHub.

### 1. Crie um repositório no GitHub
- Acesse <https://github.com/new>
- Nome: por exemplo `fotos-fantasma`
- Pode deixar **Private** (privado). **Não** marque "Add a README".
- Clique em **Create repository**.

### 2. Envie o código (na pasta `fotos_fantasma`)
Abra o PowerShell nesta pasta e rode (troque a URL pela do seu repositório):

```powershell
git init
git add .
git commit -m "Fotos Fantasma - versao gratuita inicial"
git branch -M main
git remote add origin https://github.com/SEU_USUARIO/fotos-fantasma.git
git push -u origin main
```

### 3. Baixe o APK
- No GitHub, abra a aba **Actions**.
- Clique na execução **Build APK** (roda sozinha após o push; leva ~5–10 min).
- Quando terminar (✓ verde), role até **Artifacts** e baixe
  **`fotos-fantasma-apk`** (um `.zip` com o `app-release.apk` dentro).

### 4. Instale no celular Android
- Copie o `app-release.apk` para o celular.
- Toque para instalar (será preciso permitir "instalar de fontes
  desconhecidas" para este app).
- Ao abrir, **permita o acesso à câmera**.

> Se preferir, dá para disparar o build manualmente em
> **Actions → Build APK → Run workflow**.

---

## Estrutura do projeto

```
lib/
  main.dart                      # ponto de entrada / tema
  models/photo_session.dart      # modelo de dados (comparação + parâmetros)
  services/session_store.dart    # armazenamento local (JSON + arquivos)
  screens/
    home_screen.dart             # lista de comparações
    camera_screen.dart           # câmera: ghost overlay, flash, exposição, zoom
    session_detail_screen.dart   # detalhe + foto de acompanhamento
  widgets/comparison_view.dart   # antes/depois (cortina, lado a lado, sobrepor)
ci/AndroidManifest.xml           # manifesto Android (permissão de câmera)
.github/workflows/build-apk.yml  # build do APK na nuvem
```

As pastas `android/`, `ios/`, etc. **não** são versionadas — elas são
recriadas automaticamente durante o build (`flutter create`).

## iOS (futuro)

O código é multiplataforma. Para gerar a versão iOS será preciso um Mac com
Xcode e adicionar `NSCameraUsageDescription` ao `Info.plist`. Fica para uma
próxima etapa.
