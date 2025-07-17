# Holochain Fresh Environment Setup - summon-customer

## Problem Being Solved
DHT propagation failure in existing summon environment where catalog directory links don't propagate between agents, taking 5+ minutes instead of seconds.

## Environment Setup Completed

### 1. System Dependencies (✅ DONE)
```bash
sudo apt install -y libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libgtk-3-dev libasound2t64 adwaita-icon-theme
```

### 2. Holochain Development Environment (✅ DONE)
```bash
bash <(curl https://holochain.github.io/holochain/setup.sh)
```

### 3. Installation Verification (✅ DONE)
```bash
# Scaffolding tool
nix run --refresh -j0 -v "github:holochain/holonix?ref=main-0.5#hc-scaffold" -- --version
# Output: holochain_scaffolding_cli 0.500.1

# Holochain conductor
nix run "github:holochain/holonix?ref=main-0.5#holochain" -- --version
# Output: holochain 0.5.4
```

## Current Status
- Fresh Holochain 0.5.4 environment ready
- Empty directory ready for file copying
- Original summon app uses Holochain 0.5.3 (will be updated or kept as-is)

## Next Steps
1. Copy all files from original summon directory
2. Run `nix develop` to enter dev shell
3. Test DHT propagation with debugging logs
4. Verify catalog links propagate between agents in seconds (not minutes)

## Key Files to Copy
- `/ui/` - Complete UI directory
- `/dnas/` - All DNA code with debugging logs
- Root config files (package.json, happ.yaml, flake.nix, etc.)

## Expected Fix
Clean environment should resolve DHT networking/state corruption preventing link propagation between agents.