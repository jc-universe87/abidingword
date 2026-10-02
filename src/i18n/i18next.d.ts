// Types every t("area.key") call against the English messages, so a
// missing or misspelt key is a type error.
import "i18next";
import type { Messages } from "./resources";

declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "translation";
    resources: { translation: Messages };
    returnNull: false;
  }
}
