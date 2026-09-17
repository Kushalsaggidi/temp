"use client";

import { IconInvestigate } from "@/components/ui/icons";

import { useInvestigation } from "./investigation-provider";

/** Opens the shared investigation drawer for one asset version. */
export function InvestigateButton({
  assetVersionId,
  assetName,
  variant = "secondary",
  size = "sm",
  label = "Check readiness",
}: {
  assetVersionId: string;
  assetName: string;
  variant?: "primary" | "secondary";
  size?: "sm" | "md";
  label?: string;
}) {
  const investigation = useInvestigation();
  const classes = [
    "btn",
    variant === "secondary" ? "btn--secondary" : "",
    size === "sm" ? "btn--sm" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      className={classes}
      type="button"
      onClick={() => investigation.open(assetVersionId, assetName)}
    >
      <IconInvestigate className="btn__icon" />
      {label}
    </button>
  );
}
