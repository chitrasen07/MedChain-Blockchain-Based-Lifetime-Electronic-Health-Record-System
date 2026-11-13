import { pages } from "../config/workspaces";

const homes = {
  "Hospital Admin": "/admin",
  Doctor: "/doctor",
  Receptionist: "/receptionist",
  "Hospital Staff": "/staff",
  Reviewer: "/reviewer",
  Patient: "/patient",
  "Emergency Staff": "/emergency",
};

export function pageChrome(pageKey) {
  const page = pages[pageKey];
  const home = homes[page.eyebrow];
  const crumbs =
    page.title === "Overview"
      ? [{ label: page.eyebrow }]
      : [
          { label: page.eyebrow, to: home },
          { label: page.title },
        ];
  return { page, crumbs };
}
