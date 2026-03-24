# Tokito Bot Web

Bot WhatsApp com painel web, QR Code, conexão por número, XP, anti-link, welcome e painel em tempo real.

## Requisitos

- Node 20 recomendado
- Yarn ou npm

## Instalação com Yarn

```bash
rm -rf node_modules yarn.lock package-lock.json sessions
npm cache clean --force
npm install -g yarn

yarn install
```

## Iniciar

```bash
yarn start
```

Abra no navegador:

```txt
http://localhost:3000
```

## Importante para Termux

Se a sessão antiga estiver bugada, limpe antes de conectar de novo:

```bash
rm -rf sessions
```

## Comandos

- ainda em desenvolvimento

## Correções nesta versão

- adicionada dependência `async-mutex`
- proteção contra `SessionError: No sessions`
- reconexão automática mais segura
- geração de código de pareamento apenas uma vez por tentativa
- tratamento de erros no recebimento de mensagens
