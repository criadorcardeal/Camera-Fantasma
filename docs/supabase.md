# Guia do Supabase — fundação de contas + créditos + vouchers (ComparaCam)

Objetivo desta fase: **login** + **saldo de créditos no servidor** (autoritativo) +
**vouchers** que parceiros (labs / material hospitalar) compram e o médico resgata.

> **Privacidade:** as **fotos dos pacientes continuam SÓ no aparelho** (IndexedDB).
> Nada de foto vai para o servidor — apenas conta, saldo e vouchers.

Modelo de monetização priorizado (B2B):
1. **Vouchers** de crédito vendidos a parceiros → médico resgata no app.
2. **Patrocínio/banner** vendido a parceiros.
3. Compra avulsa do médico (Mercado Pago) — entra quando houver CNPJ/MEI + conta MP.
4. ~~Anúncio recompensado de loja~~ — descartado (PWA não usa SDK de loja; nicho = receita ~zero; IAP tomaria 15–30%).

---

## Parte 1 — Criar o projeto (você faz, ~5 min)
1. Acesse **supabase.com** → *Start your project* → entre com GitHub ou e-mail.
2. *New project*:
   - **Name:** `comparacam`
   - **Database Password:** gere uma senha forte e **guarde** (não compartilhe).
   - **Region:** *South America (São Paulo)*.
   - **Plan:** Free.
3. Espere ~2 min provisionar.

## Parte 2 — Pegar as chaves
- Menu **Settings (engrenagem) → API**.
- **Públicas (podem ser compartilhadas / ficam no app):** `Project URL` e a `anon public` key.
- **SECRETAS (nunca compartilhar):** `service_role` key e a senha do banco. Elas só
  vão em variáveis de ambiente / *secrets* das Edge Functions do próprio Supabase.

## Parte 3 — Ligar o login por e-mail (link mágico, sem senha)
- **Authentication → Providers → Email:** habilite.
- **Authentication → URL Configuration:** em *Site URL* e *Redirect URLs*, coloque
  `https://criadorcardeal.github.io/Camera-Fantasma/`.

## Parte 4 — Criar as tabelas (SQL)
Em **SQL Editor → New query**, cole e clique **Run**.

```sql
create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  display_name text, created_at timestamptz default now());

create table public.wallets (
  user_id uuid primary key references auth.users on delete cascade,
  balance int not null default 0 check (balance >= 0),
  updated_at timestamptz default now());

create table public.credit_transactions (
  id bigserial primary key,
  user_id uuid not null references auth.users on delete cascade,
  delta int not null, reason text not null, ref text,
  created_at timestamptz default now());

create table public.partners (
  id uuid primary key default gen_random_uuid(),
  name text not null, cnpj text, contact text,
  created_at timestamptz default now());

create table public.voucher_batches (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid references public.partners,
  credits_each int not null, note text,
  created_at timestamptz default now());

create table public.vouchers (
  code text primary key,
  batch_id uuid references public.voucher_batches,
  credits int not null,
  status text not null default 'active',       -- 'active' | 'redeemed'
  redeemed_by uuid references auth.users,
  redeemed_at timestamptz, expires_at timestamptz,
  created_at timestamptz default now());

alter table public.profiles enable row level security;
alter table public.wallets enable row level security;
alter table public.credit_transactions enable row level security;
alter table public.vouchers enable row level security;
alter table public.partners enable row level security;
alter table public.voucher_batches enable row level security;

create policy "perfil proprio"   on public.profiles            for select using (auth.uid() = id);
create policy "carteira propria" on public.wallets             for select using (auth.uid() = user_id);
create policy "extrato proprio"  on public.credit_transactions for select using (auth.uid() = user_id);
-- vouchers / partners / voucher_batches: sem policy de SELECT p/ usuário comum
-- (acesso só via função redeem_voucher ou pelo painel admin com service_role).

-- Resgate seguro e atômico do voucher (valida + credita)
create or replace function public.redeem_voucher(p_code text)
returns int language plpgsql security definer set search_path = public as $$
declare v_credits int; v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'nao autenticado'; end if;
  update public.vouchers set status='redeemed', redeemed_by=v_uid, redeemed_at=now()
   where code=p_code and status='active' and (expires_at is null or expires_at>now())
  returning credits into v_credits;
  if v_credits is null then raise exception 'voucher invalido ou ja usado'; end if;
  insert into public.wallets(user_id,balance) values (v_uid,v_credits)
    on conflict (user_id) do update set balance=public.wallets.balance+excluded.balance, updated_at=now();
  insert into public.credit_transactions(user_id,delta,reason,ref) values (v_uid,v_credits,'voucher',p_code);
  return v_credits;
end $$;

-- Cria carteira/perfil automaticamente ao cadastrar
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  insert into public.profiles(id) values (new.id) on conflict do nothing;
  insert into public.wallets(user_id,balance) values (new.id,0) on conflict do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();
```

**Por que é seguro:** o saldo (`wallets`) só muda por funções do servidor; o usuário
**lê só o próprio** saldo/extrato (RLS); o voucher é validado por **consulta no banco**
(existe? ativo? não venceu?) e creditado de forma **atômica** — à prova de uso duplo/fraude,
sem precisar de nada "cripto".

## Parte 5 — O que o desenvolvimento faz depois (precisa de `Project URL` + `anon key`)
1. **Login no app** por link mágico + tela de conta.
2. **Migrar os créditos** do `localStorage` para o servidor (ler saldo; reservar/confirmar
   via função). Remove o PIN `1234` inseguro.
3. **Resgatar voucher** no app (chama `redeem_voucher`).
4. **Painel simples** para criar parceiros e gerar lotes de vouchers (admin, via `service_role`
   numa Edge Function ou direto no dashboard).
5. (Mais tarde, com CNPJ/MEI + conta Mercado Pago) **webhook de pagamento** — plugável
   nessa mesma base, para a compra avulsa do médico.

---

## Parte 6 — Vídeo do patrocinador por grupo de vouchers (v4.8)

Cada **grupo de vouchers** (`voucher_batches`) pode ter um vídeo do patrocinador que
toca (obrigatório) logo após o resgate. Rode este SQL uma vez em **SQL Editor**:

```sql
-- 1) Campo do vídeo no grupo de vouchers
alter table public.voucher_batches add column if not exists video_url text;

-- 2) redeem_voucher passa a devolver {credits, video_url} (jsonb)
drop function if exists public.redeem_voucher(text);
create or replace function public.redeem_voucher(p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_credits int; v_batch uuid; v_video text; v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'nao autenticado'; end if;
  update public.vouchers set status='redeemed', redeemed_by=v_uid, redeemed_at=now()
   where code=p_code and status='active' and (expires_at is null or expires_at>now())
  returning credits, batch_id into v_credits, v_batch;
  if v_credits is null then raise exception 'voucher invalido ou ja usado'; end if;
  insert into public.wallets(user_id,balance) values (v_uid,v_credits)
    on conflict (user_id) do update set balance=public.wallets.balance+excluded.balance, updated_at=now();
  insert into public.credit_transactions(user_id,delta,reason,ref) values (v_uid,v_credits,'voucher',p_code);
  select video_url into v_video from public.voucher_batches where id = v_batch;
  return jsonb_build_object('credits', v_credits, 'video_url', v_video);
end $$;
```

### Como subir o vídeo e ligá-lo a um grupo de vouchers (para testar)
1. **Storage → Create bucket:** nome `videos`, marque **Public bucket**. Create.
2. Abra o bucket `videos` → **Upload file** → escolha o `.mp4` (ideal: retrato,
   5–30 s, H.264/AAC, alguns MB).
3. No arquivo enviado → **Get URL** (URL pública). Fica algo como
   `https://<ref>.supabase.co/storage/v1/object/public/videos/anuncio.mp4`.
4. **Criar um grupo de vouchers com esse vídeo** (SQL Editor):
   ```sql
   -- (opcional) um parceiro
   insert into public.partners(name) values ('Parceiro Teste')
     returning id;   -- copie o id se quiser vincular

   -- grupo (lote) de vouchers com o vídeo
   insert into public.voucher_batches(credits_each, note, video_url)
   values (10, 'Lote teste com video',
           'https://<ref>.supabase.co/storage/v1/object/public/videos/anuncio.mp4')
   returning id;     -- copie o id do lote

   -- gerar alguns vouchers nesse lote (troque <BATCH_ID>)
   insert into public.vouchers(code, batch_id, credits) values
     ('TESTE-VIDEO-1', '<BATCH_ID>', 10),
     ('TESTE-VIDEO-2', '<BATCH_ID>', 10);
   ```
5. No app: **Adquirir créditos → Resgatar** com `TESTE-VIDEO-1`. Após confirmar, o
   **vídeo do lote** toca em tela cheia; "Rever"/"Sair" habilitam ao final.

> Para trocar o vídeo de um grupo: `update public.voucher_batches set video_url='<nova URL>' where id='<BATCH_ID>';`
> Se um lote não tiver `video_url`, o app usa o padrão global (`REWARD_VIDEO_URL`
> em `account.js`) ou o marcador temporizado de 8 s.

---

## Parte 7 — Painel de criação de vouchers no app (admin) (v4.9)

Cria grupos de vouchers direto pelo app (⚙ Administração → "Criar grupo de vouchers"),
definindo créditos por voucher, quantidade e vídeo. **Só funciona para contas
administradoras** — a criação passa por um RPC que valida `auth.uid()` na tabela `admins`.

### A) SQL (rode uma vez em SQL Editor)
```sql
-- Tabela de administradores (quem pode criar vouchers)
create table if not exists public.admins (
  user_id uuid primary key references auth.users on delete cascade,
  created_at timestamptz default now());
alter table public.admins enable row level security;   -- sem policies: só via função/dashboard

create or replace function public.is_admin() returns boolean
language sql security definer set search_path=public stable as $$
  select exists(select 1 from public.admins where user_id = auth.uid());
$$;

-- Cria o lote + N vouchers com códigos aleatórios (admin apenas)
create or replace function public.admin_create_batch(
  p_credits_each int, p_qty int, p_video_url text, p_note text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_batch uuid; v_codes text[] := '{}'; v_code text; i int;
begin
  if not public.is_admin() then raise exception 'sem permissao (admin)'; end if;
  if p_qty < 1 or p_qty > 500 then raise exception 'quantidade invalida'; end if;
  if p_credits_each < 1 then raise exception 'creditos invalidos'; end if;
  insert into public.voucher_batches(credits_each, note, video_url)
    values (p_credits_each, p_note, nullif(p_video_url,''))
    returning id into v_batch;
  for i in 1..p_qty loop
    v_code := upper(substr(replace(gen_random_uuid()::text,'-',''),1,8));
    insert into public.vouchers(code, batch_id, credits) values (v_code, v_batch, p_credits_each);
    v_codes := array_append(v_codes, v_code);
  end loop;
  return jsonb_build_object('batch_id', v_batch, 'codes', v_codes);
end $$;

grant execute on function public.is_admin() to anon, authenticated;
grant execute on function public.admin_create_batch(int,int,text,text) to anon, authenticated;
```

### B) Marcar sua conta como administradora (uma vez)
1. **Authentication → Users** → clique no seu usuário (`criadorcardeal@gmail.com`) →
   copie o **UID** (User UID).
2. **SQL Editor** → rode (troque o UID):
   ```sql
   insert into public.admins(user_id) values ('COLE_SEU_UID_AQUI')
     on conflict do nothing;
   ```

### C) Usar no app
No app, logado como admin: **⚙ (topo esquerdo) → PIN** (padrão `1234`) →
**Criar grupo de vouchers** → preencha créditos/quantidade/URL do vídeo → **Gerar vouchers**.
Os códigos aparecem numa caixa para copiar e enviar aos médicos. O vídeo colado fica
associado a todos os vouchers daquele grupo.

### D) Upload de vídeo pelo app (bucket + policy) — v5.0
Para o botão **"Escolher arquivo"** enviar o vídeo direto pelo painel:
1. **Storage → New bucket:** nome exatamente **`videos`**, marque **Public bucket** → Create.
2. **SQL Editor** → rode (permite leitura pública e upload só de admin):
   ```sql
   create policy "videos leitura publica" on storage.objects
     for select using (bucket_id = 'videos');
   create policy "videos upload admin" on storage.objects
     for insert to authenticated
     with check (bucket_id = 'videos' and public.is_admin());
   ```
No painel, o admin escolhe o arquivo → o app envia para `videos/` e associa a URL ao
grupo automaticamente. (Colar uma URL manual continua funcionando como alternativa.)

> A engrenagem ⚙ (v5.0) **só aparece para contas admin** (o app checa `is_admin()` no
> login). Usuário comum não vê nem abre a Administração.

---

## Parte 9 — Saldo no servidor como fonte única (gasto/estorno) (v5.1)

A barra da home e o Perfil agora mostram o MESMO saldo (o do servidor, `wallets`).
Criar uma comparação **gasta 1 crédito no servidor**; excluir antes de concluir
**estorna**. Rode este SQL uma vez:

```sql
create or replace function public.wallet_spend(p_n int default 1)
returns int language plpgsql security definer set search_path=public as $$
declare v_uid uuid := auth.uid(); v_bal int;
begin
  if v_uid is null then raise exception 'nao autenticado'; end if;
  update public.wallets set balance = balance - p_n, updated_at=now()
   where user_id=v_uid and balance >= p_n
   returning balance into v_bal;
  if v_bal is null then raise exception 'saldo insuficiente'; end if;
  insert into public.credit_transactions(user_id,delta,reason) values (v_uid,-p_n,'uso');
  return v_bal;
end $$;

create or replace function public.wallet_refund(p_n int default 1)
returns int language plpgsql security definer set search_path=public as $$
declare v_uid uuid := auth.uid(); v_bal int;
begin
  if v_uid is null then raise exception 'nao autenticado'; end if;
  update public.wallets set balance = balance + p_n, updated_at=now()
   where user_id=v_uid returning balance into v_bal;
  insert into public.credit_transactions(user_id,delta,reason) values (v_uid,p_n,'estorno');
  return v_bal;
end $$;

grant execute on function public.wallet_spend(int)  to anon, authenticated;
grant execute on function public.wallet_refund(int) to anon, authenticated;
```

> O contador local antigo (`ff_credits` no localStorage) foi **abandonado**; o app
> não o usa mais. A "compra avulsa" prototipada virou apenas um aviso ("Mercado Pago
> em breve"); crédito real vem de **voucher** (ou, depois, do pagamento).

---

## Parte 10 — Gestão de vouchers no admin (listar/validade/desativar) (v5.2)

O painel passa a **listar os grupos** (resgatados/restantes, validade, vídeo), permite
**validade** na criação, **ver os códigos** de um grupo e **desativar** os que sobraram.
Rode este SQL uma vez (recria `admin_create_batch` com validade + 3 funções novas):

```sql
-- create_batch agora aceita validade em dias (p_expires_days)
drop function if exists public.admin_create_batch(int,int,text,text);
create or replace function public.admin_create_batch(
  p_credits_each int, p_qty int, p_video_url text, p_note text default null, p_expires_days int default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_batch uuid; v_codes text[] := '{}'; v_code text; i int; v_exp timestamptz;
begin
  if not public.is_admin() then raise exception 'sem permissao (admin)'; end if;
  if p_qty < 1 or p_qty > 500 then raise exception 'quantidade invalida'; end if;
  if p_credits_each < 1 then raise exception 'creditos invalidos'; end if;
  if p_expires_days is not null and p_expires_days > 0 then
    v_exp := now() + (p_expires_days || ' days')::interval; end if;
  insert into public.voucher_batches(credits_each, note, video_url)
    values (p_credits_each, p_note, nullif(p_video_url,'')) returning id into v_batch;
  for i in 1..p_qty loop
    v_code := upper(substr(replace(gen_random_uuid()::text,'-',''),1,8));
    insert into public.vouchers(code, batch_id, credits, expires_at) values (v_code, v_batch, p_credits_each, v_exp);
    v_codes := array_append(v_codes, v_code);
  end loop;
  return jsonb_build_object('batch_id', v_batch, 'codes', v_codes);
end $$;

create or replace function public.admin_list_batches()
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_res jsonb;
begin
  if not public.is_admin() then raise exception 'sem permissao (admin)'; end if;
  select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb) into v_res from (
    select b.id, b.note, b.credits_each, b.video_url, b.created_at,
      count(v.code) as total,
      count(v.code) filter (where v.status='redeemed') as redeemed,
      count(v.code) filter (where v.status='active') as active,
      count(v.code) filter (where v.status='disabled') as disabled,
      min(v.expires_at) as expires_at
    from public.voucher_batches b
    left join public.vouchers v on v.batch_id = b.id
    group by b.id order by b.created_at desc) t;
  return v_res;
end $$;

create or replace function public.admin_batch_codes(p_batch uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_res jsonb;
begin
  if not public.is_admin() then raise exception 'sem permissao (admin)'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('code',code,'status',status) order by code), '[]'::jsonb)
    into v_res from public.vouchers where batch_id = p_batch;
  return v_res;
end $$;

create or replace function public.admin_disable_batch(p_batch uuid)
returns int language plpgsql security definer set search_path=public as $$
declare n int;
begin
  if not public.is_admin() then raise exception 'sem permissao (admin)'; end if;
  update public.vouchers set status='disabled' where batch_id=p_batch and status='active';
  get diagnostics n = row_count; return n;
end $$;

grant execute on function public.admin_create_batch(int,int,text,text,int) to anon, authenticated;
grant execute on function public.admin_list_batches() to anon, authenticated;
grant execute on function public.admin_batch_codes(uuid) to anon, authenticated;
grant execute on function public.admin_disable_batch(uuid) to anon, authenticated;
```

No painel: os grupos aparecem em "Grupos criados" (botão **Atualizar**); cada card mostra
resgatados/restantes, validade e se tem vídeo, com **Ver códigos** e **Desativar restantes**.

---

## Parte 11 — Código do voucher com a Observação como prefixo (v6.0)

Os códigos gerados passam a ser **OBSERVAÇÃO + números** (ex.: `PARCEIROALPHA-9F3A21`),
facilitando identificar o parceiro. Rode este SQL (recria só o `admin_create_batch`):

```sql
drop function if exists public.admin_create_batch(int,int,text,text,int);
create or replace function public.admin_create_batch(
  p_credits_each int, p_qty int, p_video_url text, p_note text default null, p_expires_days int default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_batch uuid; v_codes text[] := '{}'; v_code text; i int; v_exp timestamptz; v_prefix text;
begin
  if not public.is_admin() then raise exception 'sem permissao (admin)'; end if;
  if p_qty < 1 or p_qty > 500 then raise exception 'quantidade invalida'; end if;
  if p_credits_each < 1 then raise exception 'creditos invalidos'; end if;
  if p_expires_days is not null and p_expires_days > 0 then
    v_exp := now() + (p_expires_days || ' days')::interval; end if;
  -- prefixo = Observação sem acentos/espaços/símbolos, MAIÚSCULA, até 16 chars
  v_prefix := upper(regexp_replace(coalesce(p_note,''), '[^a-zA-Z0-9]+', '', 'g'));
  v_prefix := substr(v_prefix, 1, 16);
  insert into public.voucher_batches(credits_each, note, video_url)
    values (p_credits_each, p_note, nullif(p_video_url,'')) returning id into v_batch;
  for i in 1..p_qty loop
    v_code := (case when v_prefix <> '' then v_prefix || '-' else '' end)
              || upper(substr(replace(gen_random_uuid()::text,'-',''),1,6));
    insert into public.vouchers(code, batch_id, credits, expires_at) values (v_code, v_batch, p_credits_each, v_exp);
    v_codes := array_append(v_codes, v_code);
  end loop;
  return jsonb_build_object('batch_id', v_batch, 'codes', v_codes);
end $$;

grant execute on function public.admin_create_batch(int,int,text,text,int) to anon, authenticated;
```

---

## Pendências fora do código (responsabilidade do dono do produto)
- **CNPJ/MEI** e **conta Mercado Pago empresarial** (para receber e emitir nota).
- **Termos de Uso + Política de Privacidade** e conformidade **LGPD**.
- Regras de propaganda médica (Anvisa/CFM) caso use patrocínio de indústria.
