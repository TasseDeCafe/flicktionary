# CLI Guide

Learn how to get up and running with the Doppler CLI to inject secrets into your applications.

## Installation

The Doppler CLI provides access to your secrets in every environment, from local development, CI/CD, staging, and production. It is a lightweight binary available for every major operating system, package manager, and [Docker](https://docs.doppler.com/docs/dockerfile).

The Doppler CLI is open source can be found on [GitHub](https://github.com/DopplerHQ/cli).

<Callout icon="📘" theme="info">
  If your specific distribution or OS isn't mentioned below, try using the **Shell Script** installation method.
</Callout>

```shell macOS
# Prerequisite. gnupg is required for binary signature verification
brew install gnupg

# Next, install using brew (use `doppler update` for subsequent updates)
brew install dopplerhq/cli/doppler
```

```shell Windows
# winget is the recommended installation method
winget install doppler.doppler

# Scoop is also supported
scoop bucket add doppler https://github.com/DopplerHQ/scoop-doppler.git
scoop install doppler

# WSL is supported. Just follow the Shell Script process or the process
# for the OS you're using inside WSL (it defaults to Ubuntu).

# Git Bash is also supported
mkdir -p $HOME/bin
curl -Ls --tlsv1.2 --proto "=https" --retry 3 https://cli.doppler.com/install.sh | sh -s -- --install-path $HOME/bin

# When using Git Bash, your initial login and other operations requiring
# interactive input will need to use `winpty` due to this bug:
# https://github.com/skratchdot/open-golang/issues/34
#
# winpty doppler login
```

```shell Alpine
wget -q -t3 'https://packages.doppler.com/public/cli/rsa.8004D9FF50437357.key' -O /etc/apk/keys/cli@doppler-8004D9FF50437357.rsa.pub
echo 'https://packages.doppler.com/public/cli/alpine/any-version/main' | tee -a /etc/apk/repositories
apk add doppler
```

```shell Debian/Ubuntu
# Debian 11+ / Ubuntu 22.04+
sudo apt-get update && sudo apt-get install -y apt-transport-https ca-certificates curl gnupg
curl -sLf --retry 3 --tlsv1.2 --proto "=https" 'https://packages.doppler.com/public/cli/gpg.DE2A7741A397C129.key' | sudo gpg --dearmor -o /usr/share/keyrings/doppler-archive-keyring.gpg
echo "deb [signed-by=/usr/share/keyrings/doppler-archive-keyring.gpg] https://packages.doppler.com/public/cli/deb/debian any-version main" | sudo tee /etc/apt/sources.list.d/doppler-cli.list
sudo apt-get update && sudo apt-get install doppler

# Older versions of Debian/Ubuntu
sudo apt-get update && sudo apt-get install -y apt-transport-https ca-certificates curl gnupg
curl -sLf --retry 3 --tlsv1.2 --proto "=https" 'https://packages.doppler.com/public/cli/gpg.DE2A7741A397C129.key' | sudo apt-key add -
echo "deb https://packages.doppler.com/public/cli/deb/debian any-version main" | sudo tee /etc/apt/sources.list.d/doppler-cli.list
sudo apt-get update && sudo apt-get install doppler
```

```shell RedHat/CentOS/AmazonLinux
sudo rpm --import 'https://packages.doppler.com/public/cli/gpg.DE2A7741A397C129.key'
curl -sLf --retry 3 --tlsv1.2 --proto "=https" 'https://packages.doppler.com/public/cli/config.rpm.txt' | sudo tee /etc/yum.repos.d/doppler-cli.repo
sudo yum update -y && sudo yum install doppler
```

```shell Shell Script
# Does not rely on package managers
# Recommended for ephemeral environments (e.g. CI jobs)
# Supports Linux, BSD, and macOS

# Requires Curl & GnuPG:
#        Alpine: apk add curl gnupg
#   CentOS/RHEL: yum install -y curl gnupg
# Ubuntu/Debian: apt install -y curl gnupg
#   AmazonLinux: yum install -y --allowerasing gnupg2

(curl -Ls --tlsv1.2 --proto "=https" --retry 3 https://cli.doppler.com/install.sh || wget -t 3 -qO- https://cli.doppler.com/install.sh) | sudo sh
```

Now, verify the Doppler CLI was installed by checking its version.

```shell Command Line
doppler --version
```

You can also upgrade the CLI to the latest version at any time.

```shell Command Line
doppler update
```

## Authentication

The Doppler CLI requires an API key for authentication. Access can be granted via the login flow for local development or using a [Service Token](https://docs.doppler.com/docs/enclave-service-tokens) for production environments as it restricts access to a specific config within a Project.

```shell Local Development
doppler login
```

```shell Service Token
# Service Token can be generated using the CLI or the dashboard

echo 'dp.st.prd.xxxx' | doppler configure set token --scope /
```

## Basic Usage

You can fetch the latest versions of your secrets for your project and selected config using the run command, which injects them as environment variables into the running process from your command or script.

```shell Single Command
doppler run -- your-command-here
```

```shell Multiple Commands
doppler run --command="./configure && ./process-jobs; ./cleanup"
```

Because Doppler injects secrets as environment variables, it works for any language, framework, platform, and cloud provider.

```javascript Node
const secret = process.env["SECRET_NAME"]
```

```python Python
secret = os.getenv("SECRET_NAME")
```

```ruby Ruby
secret = ENV["SECRET_NAME"]
```

```go Go
secret := os.Getenv("SECRET_NAME")
```

```java Java
String secret = System.getenv().get("SECRET_NAME")
```

```php PHP
$secret = $_ENV["SECRET_NAME"]
```

```rust
secret = env::var("SECRET_NAME")
```

```kotlin
var secret: String = System.getenv("SECRET_NAME")
```

```scala
def secret = System.getenv("SECRET_NAME")
```

```cplusplus
char const* secret = getenv("SECRET_NAME");
```

To run one-off commands using a secret in Doppler, please make sure to escape the secret or use single quotes. You will need to do this to guard against shell parsing the variable before the run command executes.

```shell Escaped
doppler run --command="echo \$SECRET_NAME"
```

```shell Single Quotes
doppler run --command='echo $SECRET_NAME'
```

```shell Individual
echo $(doppler secrets get SECRET_NAME --plain)
```

## Accessing Secrets

The Doppler CLI has numerous methods for supplying secrets to your application. See our dedicated [Accessing Secrets Guide](https://docs.doppler.com/docs/accessing-secrets) to learn more.

## Setting Secrets

The CLI several easy to use options for setting and importing secrets. See our dedicated [Setting Secrets Guide](setting-secrets) to learn more.

## Shell Completion

Command completions are installed automatically. If completions are not working for you, add the following to your `~/.bash_profile` or similar:

```shell
source <(doppler completion 2> /dev/null)
```

## Running aliased commands

Running aliased commands is currently not supported. To use an alias, source your aliases file before executing your app.

```shell
doppler run --command="source ~/.bash_aliases && my_aliased_command"
```

## Multiple workplaces

The Doppler CLI supports multiple workplaces by allowing you to scope your login to a specific directory. Any applications inside your chosen directory (and its sub-directories) will automatically use the correct API key. Take a look at our docs on [using the CLI with multiple workplaces](https://docs.doppler.com/docs/multiple-workplaces) for more information.

## Running an alternative shell

When using the `--command` flag, the Doppler CLI will determine what shell to use based on the `SHELL` environment variable. The CLI currently supports `sh`, `bash`, `zsh`, `dash`, `fish`, `ksh`, `tcsh`, and `csh`. If you are using an alternative shell, the CLI will fall back to `sh`. You can manually specify your preferred shell.

```shell
# e.g. use zsh2
doppler run -- zsh2 -c "printenv DOPPLER_CONFIG"
```

## Update

The Doppler CLI supports updating itself via the `doppler update` command. This will automatically download and install the latest version of the CLI.

The CLI will also prompt you to update whenever a new version is released.

> 🚧 Windows Users
>
> This command is not supported on Windows when installed via Scoop. Instead, we recommend using winget.

## List of Commands

The below is a list of the top-level commands available in the Doppler CLI. To get additional information about any given command, use the built-in CLI help by passing in the `-h` flag like this: `doppler run -h`.

```text Available Commands
Usage:
  doppler [flags]
  doppler [command]

Available Commands:
  activity     Get workplace activity logs
  changelog    View the CLI's changelog
  completion   Print shell completion script
  configs      Manage configs
  configure    View the config file
  environments Manage environments
  feedback     Provide feedback about the Doppler CLI
  flags        View current flags
  help         Help about any command
  import       Import projects into your Doppler workplace
  login        Authenticate to Doppler
  logout       Log out of the CLI
  me           Get info about the currently authenticated entity
  open         Open the Doppler dashboard
  projects     Manage projects
  run          Run a command with secrets injected into the environment
  secrets      Manage secrets
  settings     Get workplace settings
  setup        Setup the Doppler CLI for managing secrets
  tui          Launch TUI (BETA)
  update       Update the Doppler CLI

Flags:
      --api-host string                 The host address for the Doppler API (default "https://api.doppler.com")
      --attempts int                    number of http request attempts made before failing (default 5)
      --config-dir string               config directory (default "/Users/me/.doppler")
      --dashboard-host string           The host address for the Doppler Dashboard (default "https://dashboard.doppler.com")
      --debug                           output additional information
      --dns-resolver-address string     address to use for DNS resolution (default "1.1.1.1:53")
      --dns-resolver-proto string       protocol to use for DNS resolution (default "udp")
      --dns-resolver-timeout duration   max dns lookup duration (default 5s)
      --enable-dns-resolver             bypass the OS's default DNS resolver
  -h, --help                            help for doppler
      --json                            output json
      --no-check-version                disable checking for Doppler CLI updates
      --no-read-env                     do not read config from the environment
      --no-timeout                      disable http timeout
      --no-verify-tls                   do not verify the validity of TLS certificates on HTTP requests (not recommended)
      --print-config                    output active configuration
      --scope string                    the directory to scope your config to (default ".")
      --silent                          disable output of info messages
      --timeout duration                max http request duration (default 10s)
  -t, --token string                    doppler token
  -v, --version                         Get the version of the Doppler CLI

Use "doppler [command] --help" for more information about a command.
```

## Commonly Used Commands

These are some commonly used commands that you'll likely find yourself using pretty regularly. There are more advanced ways to use the CLI, so we recommend exploring the available commands, but this should help jump start your usage!

### Assign a directory to a specific config

You can perform an operation that assigns a specific directory (and its subdirectories) to a particular config. This allows you to run commands without specifying the project (`-p`) and config (`-c`) flags.

```shell
doppler setup
```

If you like, you can also create a `doppler.yaml` file that notes which project and config should be set using `doppler setup`:

```yaml doppler.yaml
setup:
  - project: your-project-name
    config: your-config-name
```

If you have a monorepo-style project where a variety of subdirectories should map to different Doppler projects, you can handle that as well:

```yaml doppler.yaml
setup:
  - project: backend
    config: dev_personal
    path: backend/
  - project: frontend
    config: dev_personal
    path: frontend/
  - project: worker
    config: dev_personal
    path: worker/
```

You can then run `doppler setup --no-interactive` to set this up automatically without an interactive prompt.

### Run a command with secrets populated in environment

Populate the environment for a command with the secrets from your config.

```shell
doppler run -p PROJECT -c CONFIG -- YOUR_COMMAND_HERE
```

If you need to reference the secret environment variable in your command string, use this syntax:

```shell
doppler run -p PROJECT -c CONFIG --command 'YOUR_COMMAND_HERE --some-flag $SOME_VARIABLE'
```

### Fetch secrets from a config

Print the secrets from a config in the designated format to STDOUT. If you don't use the `--no-file` flag, then it will save as an encrypted [fallback file](https://docs.doppler.com/docs/automatic-fallbacks).

```shell
doppler secrets download --no-file --format=json
```

### Fetch CLI token from your local environment

You can fetch the CLI token being used in your local shell (which is set when you do a `doppler login`) using this command:

```shell
doppler configure get token --plain
```

This can be useful when doing testing with the API or other areas where you need a service token:

```shell
curl -H "Authorization: Bearer $(doppler configure get token --plain)" "https://api.doppler.com/v3/...."
```

### Generate an ephemeral service token

If you need to generate a service token that will expire, you can do so via the CLI like this:

```shell
doppler configs tokens create your-token-name-here -p PROJECT -c CONFIG --max-age 1m --plain
```

You can make use of this in scripts or other automation by assigning it to a variable like this:

```shell
DOPPLER_TOKEN=$(doppler configs tokens create your-token-name-here -p example-api -c dev --max-age 1m --plain)
doppler run -- YOUR_COMMAND_HERE
```