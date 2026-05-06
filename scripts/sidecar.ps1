param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("build", "run", "test")]
  [string]$Command
)

$ErrorActionPreference = "Stop"
$env:CMAKE_GENERATOR = "Visual Studio 17 2022"

function Invoke-Cargo {
  param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$CargoArgs
  )
  cargo @CargoArgs
  if ($LASTEXITCODE -ne 0) {
    throw "cargo $($CargoArgs -join ' ') failed with exit code $LASTEXITCODE"
  }
}

switch ($Command) {
  "build" {
    Invoke-Cargo build -p jettbot-voice-sidecar --release
  }
  "run" {
    Invoke-Cargo run -p jettbot-voice-sidecar
  }
  "test" {
    Invoke-Cargo test -p jettbot-voice-sidecar
  }
}
