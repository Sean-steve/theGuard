/**
 * Demo-only, server-side Guard entitlement application.
 * The website never sees a project key or a financial balance.
 */
export function pageForLicense(decision, page) {
  const requested = page === "portfolio" ? "portfolio" : "home";
  const blockedMarketing = decision?.status === "RESTRICTED" &&
    decision.restrict === true && decision.scope === "licensed_marketing_site";
  const blockedPortfolio = decision?.status === "RESTRICTED" &&
    decision.restrict === true && decision.scope === "premium_features";
  const restricted = blockedMarketing || (requested === "portfolio" && blockedPortfolio);
  return {
    page: restricted ? "restricted.html" : requested === "portfolio" ? "portfolio.html" : "index.html",
    blocked: restricted,
    status: ["ACTIVE", "GRACE", "RESTRICTED", "PERMANENT", "UNKNOWN"].includes(decision?.status)
      ? decision.status : "UNKNOWN"
  };
}
export function publicStatus(decision) {
  return {
    status: ["ACTIVE", "GRACE", "RESTRICTED", "PERMANENT", "UNKNOWN"].includes(decision?.status)
      ? decision.status : "UNKNOWN",
    restricted_marketing: decision?.status === "RESTRICTED" &&
      decision.restrict === true && decision.scope === "licensed_marketing_site",
    restricted_portfolio: decision?.status === "RESTRICTED" &&
      decision.restrict === true && ["licensed_marketing_site", "premium_features"].includes(decision.scope),
    demonstration_only: true,
    message: "Synthetic licensing demonstration. No payment details are published."
  };
}
