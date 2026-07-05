# Migrar o ComparaCam para as lojas — custos e caminhos

Análise honesta dos **caminhos**, **custos iniciais** e **de manutenção** para levar o
ComparaCam às lojas (App Store / Google Play), e o impacto no modelo de vouchers.

> Valores aproximados (jul/2026), convertidos ~US$1 = R$5,5. Servem de ordem de grandeza.

## Contas de desenvolvedor (obrigatórias, qualquer caminho)
| Loja | Custo | Observação |
|---|---|---|
| **Apple Developer** | **US$ 99/ano** (~R$ 550/ano) | Recorrente. Exige **CNPJ** (conta de organização) e um **Mac** (ou CI macOS) para compilar/enviar. |
| **Google Play** | **US$ 25 uma vez** (~R$ 140) | Pagamento único. |

## Três caminhos

### A) Continuar PWA (hoje) — R$ 0
- **Inicial:** ~R$ 0 (já está no ar via GitHub Pages).
- **Manutenção:** ~R$ 0 + Supabase/Brevo grátis; domínio opcional (~R$ 40–60/ano).
- **Prós:** um código só, atualização instantânea (sem revisão de loja), sem taxa de 15–30%.
- **Contras:** menos "confiável" para o usuário leigo; instalação manual no iPhone; iOS não dá flash/lanterna via web.

### B) Empacotar o PWA num app nativo ("wrapper" — Capacitor/PWABuilder) — recomendado se for às lojas
Envolve o mesmo site num "casco" nativo. **Reaproveita ~100% do código atual.**
- **Ferramentas:** Capacitor, PWABuilder, Median.co — as open-source (Capacitor/PWABuilder) são **grátis**; serviços gerenciados custam ~US$ 0–1.500.
- **Inicial (se contratar um dev para configurar + publicar nas 2 lojas):** **R$ 3.000–10.000** (uma vez). Se fizermos internamente, cai bastante (horas de trabalho + as taxas das contas).
- **Manutenção:** contas (US$ 99/ano Apple) + reenvio à loja a cada atualização relevante + acompanhar mudanças de política. **~R$ 800–2.500/ano** em esforço/serviços.
- **Prós:** ícone na loja (confiança), acesso a câmera/flash nativos possível, notificações; mantém 1 código base.
- **Contras/riscos:**
  - **Apple pode rejeitar "wrapper puro"** (Diretriz 4.2 — "app é só um site"). Precisa entregar valor nativo (câmera nativa, etc.) para passar.
  - **Revisão da Apple** a cada versão (1–3 dias; pode reprovar) — fim da atualização instantânea.
  - **App de saúde** recebe escrutínio maior na revisão.

### C) Reescrever nativo de verdade (Swift + Kotlin, ou Flutter/React Native)
- **Inicial:** **R$ 30.000–100.000+** e **meses** de desenvolvimento.
- **Manutenção:** 1–2 bases de código, atualizações a cada nova versão de iOS/Android — **R$ 5.000–20.000/ano**.
- **Prós:** melhor desempenho e recursos nativos (câmera/flash ótimos).
- **Contras:** caro, lento, maior custo permanente. **Só se justifica com escala grande.**

## O ponto crítico: taxa das lojas (IAP 15–30%)
- Se você **vender créditos DENTRO do app** (compra avulsa), Apple/Google **exigem o pagamento pela loja** e cobram **15–30%** — o que **conflita com o modelo de vouchers B2B** (parceiro compra, médico resgata).
- **Boa notícia:** hoje o app **não vende crédito dentro dele** — o crédito vem de **voucher** (resgate). Voucher resgatado (não comprado no app) normalmente **não** dispara a taxa. Então dá para ir às lojas **sem** pagar 15–30%, desde que a compra de crédito continue **fora** do app (site/Mercado Pago/parceiro) e o app só **resgate**.
- Se um dia colocar **compra avulsa dentro do app**, aí a taxa incide (Apple aceita gateway externo em alguns países/condições, mas é área sensível).

## Pré-requisitos que dependem de você
- **CNPJ/MEI** (a conta Apple de organização e a emissão de nota exigem).
- **Mac** para build iOS (ou CI macOS pago; GitHub Actions tem runner macOS com cota).
- Materiais da loja: ícone (temos), descrições, **screenshots**, política de privacidade publicada (temos o texto), classificação etária, e — por ser saúde — possíveis declarações extras.

## Resumo (ordem de grandeza)
| Caminho | Inicial | Por ano | Atualização | Taxa loja |
|---|---|---|---|---|
| **A. PWA (hoje)** | ~R$ 0 | ~R$ 0–60 | instantânea | nenhuma |
| **B. Wrapper** | R$ 3–10 mil (uma vez) | ~R$ 1,3–3 mil | revisão 1–3 dias | 0% se só resgatar voucher |
| **C. Nativo** | R$ 30–100 mil+ | R$ 5–20 mil | revisão 1–3 dias | idem |

## Recomendação honesta
1. **Agora:** manter **PWA** e reforçar a "cara de app" (ícone/instalação — já feito). Custo ~zero, iteração rápida — ideal para validar com médicos.
2. **Quando houver tração + CNPJ:** ir para o **caminho B (wrapper Capacitor)**, publicando nas lojas **mantendo os créditos por voucher fora do app** para evitar a taxa de 15–30%. É o melhor custo-benefício para "estar na loja" sem reescrever nada.
3. **Caminho C (nativo)** só se o volume justificar o investimento — não é o caso no início.

> Observação de confiança: parte da sensação de "app de verdade" já melhora com o ícone na
> tela de início, splash e a Política de Privacidade visível. Estar na loja aumenta a
> percepção de confiança, mas tem custo de revisão/manutenção — vale quando houver escala.
