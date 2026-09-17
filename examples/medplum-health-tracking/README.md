# Medplum Health Tracking

## Acceptance tests

Run the Accounts acceptance suite and its local Medplum, PostgreSQL, Redis, and Keycloak stack:

```bash
npm run test:acceptance:docker
```

The stack definition is `docker-compose.acceptance.yml`. Generated Allure evidence is written to
`dhf/allure-results/` and is not committed.

To stop the local acceptance stack and remove its test data:

```bash
docker compose -f docker-compose.acceptance.yml down -v
```
