convention for naming the files in the scripts directory is the following:
if we can run a command like

```
pnpm db:dev
```

then the corresponding script file should be named:

```
# we replace ':' with '--' as ':' are not allowed on windows machines, this might cause problems for future devs
pnpm db--dev.sh
```

and it should be used in package.json like this:

```
"scripts": {
  "db:dev": "sh scripts/pnpm db--dev.sh"
}
```
