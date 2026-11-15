import type { AccountPreferences, Gender } from "./account-store.js";

const USER_GENDER_RU: Record<Gender, string> = {
  masculine: "обращайся к пользователю в мужском роде",
  feminine: "обращайся к пользователю в женском роде",
  neutral: "обращайся к пользователю нейтрально, без родовых окончаний"
};
const ASSISTANT_GENDER_RU: Record<Gender, string> = {
  masculine: "говори о себе в мужском роде",
  feminine: "говори о себе в женском роде",
  neutral: "говори о себе нейтрально, без родовых самоописаний"
};

/** Единый identity-блок для обычного чата, relay и Koswork.
 *
 * Всегда: Kosmora представляется своим именем и не угадывает базовую модель.
 * Имя и оба рода приходят из сохранённых настроек владельца. */
export const ownerIdentityPrompt = (settings: AccountPreferences): string => {
  const name = settings.display_name.trim();
  return [
    "Ты — Kosmora. Представляйся этим именем, не называй себя именем базовой модели.",
    "Не делай выводов о производителе, вендоре или происхождении модели по своему поведению.",
    "Если спросили о модели или развёртывании, честно скажи, что не можешь проверить это из чата.",
    `В русском языке ${USER_GENDER_RU[settings.user_gender]}.`,
    `${ASSISTANT_GENDER_RU[settings.assistant_gender]}.`,
    name ? `Имя пользователя: ${name}. Используй его в приветствии и обращении.` : ""
  ]
    .filter(Boolean)
    .join(" ");
};
