param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("build", "run", "test")]
  [string]$Command
)

$ErrorActionPreference = "Stop"
$env:CMAKE_GENERATOR = "Visual Studio 17 2022"

switch ($Command) {
  "build" {
    cargo build -p jettbot-voice-sidecar --release
  }
  "run" {
    cargo run -p jettbot-voice-sidecar
  }
  "test" {
    cargo test -p jettbot-voice-sidecar
  }
}
