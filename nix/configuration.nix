{ config, pkgs, ... }: {
  nix.settings.experimental-features = "nix-command flakes";

  environment.systemPackages = with pkgs; [ postgresql_16 ];

  system.stateVersion = 4;
}
