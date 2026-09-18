# Medplum Health Tracking

## Acceptance tests

Run the Accounts and Health Tracking acceptance suites with their local Medplum, PostgreSQL, Redis, and Keycloak
stack:

```bash
npm run test:acceptance:stack
```

The stack definition is `docker-compose.acceptance.yml`. Generated Allure evidence is written to
`dhf/allure-results/` and is not committed.

To stop the local acceptance stack and remove its test data:

```bash
docker compose -f docker-compose.acceptance.yml down -v
```
