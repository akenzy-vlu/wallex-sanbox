<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="200" alt="Nest Logo" /></a>
</p>

[circleci-image]: https://img.shields.io/circleci/build/github/nestjs/nest/master?token=abc123def456
[circleci-url]: https://circleci.com/gh/nestjs/nest

  <p align="center">A progressive <a href="http://nodejs.org" target="_blank">Node.js</a> framework for building efficient and scalable server-side applications.</p>
    <p align="center">
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/v/@nestjs/core.svg" alt="NPM Version" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/l/@nestjs/core.svg" alt="Package License" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/dm/@nestjs/common.svg" alt="NPM Downloads" /></a>
<a href="https://circleci.com/gh/nestjs/nest" target="_blank"><img src="https://img.shields.io/circleci/build/github/nestjs/nest/master" alt="CircleCI" /></a>
<a href="https://coveralls.io/github/nestjs/nest?branch=master" target="_blank"><img src="https://coveralls.io/repos/github/nestjs/nest/badge.svg?branch=master#9" alt="Coverage" /></a>
<a href="https://discord.gg/G7Qnnhy" target="_blank"><img src="https://img.shields.io/badge/discord-online-brightgreen.svg" alt="Discord"/></a>
<a href="https://opencollective.com/nest#backer" target="_blank"><img src="https://opencollective.com/nest/backers/badge.svg" alt="Backers on Open Collective" /></a>
<a href="https://opencollective.com/nest#sponsor" target="_blank"><img src="https://opencollective.com/nest/sponsors/badge.svg" alt="Sponsors on Open Collective" /></a>
  <a href="https://paypal.me/kamilmysliwiec" target="_blank"><img src="https://img.shields.io/badge/Donate-PayPal-ff3f59.svg"/></a>
    <a href="https://opencollective.com/nest#sponsor"  target="_blank"><img src="https://img.shields.io/badge/Support%20us-Open%20Collective-41B883.svg" alt="Support us"></a>
  <a href="https://twitter.com/nestframework" target="_blank"><img src="https://img.shields.io/twitter/follow/nestframework.svg?style=social&label=Follow"></a>
</p>
  <!--[![Backers on Open Collective](https://opencollective.com/nest/backers/badge.svg)](https://opencollective.com/nest#backer)
  [![Sponsors on Open Collective](https://opencollective.com/nest/sponsors/badge.svg)](https://opencollective.com/nest#sponsor)-->

## Description

Wallex - A NestJS-based wallet management system implementing Event Sourcing with CQRS pattern, using KurrentDB for event storage and Elasticsearch for read model projections.

## Prerequisites

- Node.js (v16 or higher)
- Docker and Docker Compose
- Yarn package manager

## Installation

```bash
$ yarn install
```

## Environment Setup

1. Copy the example environment file:
```bash
$ cp .env.example .env
```

2. Update the `.env` file with your configuration if needed. Default values work with the provided Docker Compose setup.

## Infrastructure Setup

Start the required services (KurrentDB, Elasticsearch, and Kibana):

```bash
$ docker-compose up -d
```

This will start:
- **KurrentDB**: Event store database (http://localhost:2113)
- **Elasticsearch**: Search and analytics engine (http://localhost:9200)
- **Kibana**: Elasticsearch UI (http://localhost:5601)

To stop the services:
```bash
$ docker-compose down
```

To stop and remove volumes (clean slate):
```bash
$ docker-compose down -v
```

## Running the app

```bash
# development
$ yarn run start

# watch mode
$ yarn run start:dev

# production mode
$ yarn run start:prod
```

## Test

```bash
# unit tests
$ yarn run test

# e2e tests
$ yarn run test:e2e

# test coverage
$ yarn run test:cov
```

## API Documentation

### Base URL
```
http://localhost:3000/wallets
```

### Endpoints

#### 1. Create Wallet
Creates a new wallet for a user.

**Endpoint:** `POST /wallets`

**Request Body:**
```json
{
  "walletId": "wallet-123",
  "ownerId": "user-456",
  "initialBalance": 100.00
}
```

**Response:**
```json
{
  "id": "wallet-123",
  "ownerId": "user-456",
  "balance": 100.00,
  "createdAt": "2025-10-23T10:00:00.000Z",
  "updatedAt": "2025-10-23T10:00:00.000Z",
  "version": 1
}
```

#### 2. Credit Wallet
Add funds to a wallet.

**Endpoint:** `POST /wallets/:walletId/credit`

**Request Body:**
```json
{
  "amount": 50.00,
  "description": "Deposit from bank account"
}
```

**Response:**
```json
{
  "id": "wallet-123",
  "ownerId": "user-456",
  "balance": 150.00,
  "createdAt": "2025-10-23T10:00:00.000Z",
  "updatedAt": "2025-10-23T10:05:00.000Z",
  "version": 2
}
```

#### 3. Debit Wallet
Withdraw funds from a wallet.

**Endpoint:** `POST /wallets/:walletId/debit`

**Request Body:**
```json
{
  "amount": 30.00,
  "description": "ATM withdrawal"
}
```

**Response:**
```json
{
  "id": "wallet-123",
  "ownerId": "user-456",
  "balance": 120.00,
  "createdAt": "2025-10-23T10:00:00.000Z",
  "updatedAt": "2025-10-23T10:10:00.000Z",
  "version": 3
}
```

#### 4. Transfer Between Wallets
Transfer funds from one wallet to another.

**Endpoint:** `POST /wallets/:fromWalletId/transfer`

**Request Body:**
```json
{
  "toWalletId": "wallet-789",
  "amount": 25.00,
  "description": "Payment for services"
}
```

**Response:**
```json
{
  "fromWallet": {
    "id": "wallet-123",
    "ownerId": "user-456",
    "balance": 95.00,
    "createdAt": "2025-10-23T10:00:00.000Z",
    "updatedAt": "2025-10-23T10:15:00.000Z",
    "version": 4
  },
  "toWallet": {
    "id": "wallet-789",
    "ownerId": "user-999",
    "balance": 125.00,
    "createdAt": "2025-10-23T09:00:00.000Z",
    "updatedAt": "2025-10-23T10:15:00.000Z",
    "version": 2
  }
}
```

#### 5. Get Wallet
Retrieve wallet details by ID.

**Endpoint:** `GET /wallets/:walletId`

**Response:**
```json
{
  "id": "wallet-123",
  "ownerId": "user-456",
  "balance": 95.00,
  "createdAt": "2025-10-23T10:00:00.000Z",
  "updatedAt": "2025-10-23T10:15:00.000Z",
  "version": 4
}
```

#### 6. Get All Wallets
Retrieve all wallets.

**Endpoint:** `GET /wallets`

**Response:**
```json
[
  {
    "id": "wallet-123",
    "ownerId": "user-456",
    "balance": 95.00,
    "createdAt": "2025-10-23T10:00:00.000Z",
    "updatedAt": "2025-10-23T10:15:00.000Z",
    "version": 4
  },
  {
    "id": "wallet-789",
    "ownerId": "user-999",
    "balance": 125.00,
    "createdAt": "2025-10-23T09:00:00.000Z",
    "updatedAt": "2025-10-23T10:15:00.000Z",
    "version": 2
  }
]
```

### Error Responses

#### 400 Bad Request
```json
{
  "statusCode": 400,
  "message": "Invalid amount or insufficient funds",
  "error": "Bad Request"
}
```

#### 404 Not Found
```json
{
  "statusCode": 404,
  "message": "Wallet wallet-123 not found",
  "error": "Not Found"
}
```

#### 409 Conflict
```json
{
  "statusCode": 409,
  "message": "Wallet already exists or concurrency conflict",
  "error": "Conflict"
}
```

### Example Usage with cURL

#### Create a wallet:
```bash
curl -X POST http://localhost:3000/wallets \
  -H "Content-Type: application/json" \
  -d '{
    "walletId": "wallet-123",
    "ownerId": "user-456",
    "initialBalance": 100
  }'
```

#### Transfer between wallets:
```bash
curl -X POST http://localhost:3000/wallets/wallet-123/transfer \
  -H "Content-Type: application/json" \
  -d '{
    "toWalletId": "wallet-789",
    "amount": 25,
    "description": "Payment for services"
  }'
```

## Architecture

This application follows Event Sourcing and CQRS patterns:

- **Event Sourcing**: All state changes are stored as immutable events in KurrentDB
- **CQRS**: Separate command and query paths for better scalability
- **Read Model**: Elasticsearch provides fast querying capabilities
- **Projections**: Events are projected to Elasticsearch for efficient reads

## Support

Nest is an MIT-licensed open source project. It can grow thanks to the sponsors and support by the amazing backers. If you'd like to join them, please [read more here](https://docs.nestjs.com/support).

## Stay in touch

- Author - [Kamil Myśliwiec](https://kamilmysliwiec.com)
- Website - [https://nestjs.com](https://nestjs.com/)
- Twitter - [@nestframework](https://twitter.com/nestframework)

## License

Nest is [MIT licensed](LICENSE).
