# RevenueCat Rest API V2 with Typescript

Using https://github.com/openapi-ts/openapi-typescript to talk to the RevenueCat Rest API in a typesafe way

## How I created the schema file

1. download the OpenAPI Schema from https://www.revenuecat.com/docs/redocusaurus/plugin-redoc-0.yaml
2. run the following

```bash
npx openapi-typescript plugin-redoc-0.yaml -o ./revenuecat-api-types.ts
```
