"use client";
import Link from "next/link";
import { useState } from "react";
import {
  AgentPipeline,
  ModelPicker,
  PricingTable,
  ShiningText,
  Switch,
  SystemMessage,
  VoiceOrb
} from "../ui/kosmora-controls";
import { FileTree } from "../ui/file-tree";
import { CodeFiles } from "../ui/code-files";
import { ChatResponse } from "../chat-response";
import { WorkspaceModeMenu } from "../workspace-navigation";
import styles from "./showcase.module.css";

/** Honest component review surface. Examples never dispatch AI, GitHub, microphone or payment. */
export default function InterfaceKit() {
  const [enabled, setEnabled] = useState(false);
  const [file, setFile] = useState("src/app.ts");
  const [followUp, setFollowUp] = useState("");
  return (
    <main className={styles.page}>
      <Link href="/">← Вернуться в Kosmora</Link>
      <header>
        <span>KOSMORA · INTERFACE</span>
        <h1>Один язык интерфейса</h1>
        <p>
          Компоненты из вашей подборки, адаптированные к Kosmora. Здесь примеры оформления;
          работающие элементы подключены в соответствующих разделах.
        </p>
      </header>
      <div className={styles.grid}>
        <section>
          <h2>Навигация и файлы</h2>
          <WorkspaceModeMenu
            surface="manager"
            onNavigate={(surface) => {
              window.location.href = `/?surface=${surface}`;
            }}
          />
          <FileTree
            files={[
              { path: "README.md" },
              { path: "src/app.ts" },
              { path: "src/styles.css" },
              { path: "docs/plan.md" }
            ]}
            selected={file}
            onSelect={setFile}
          />
          <p className={styles.caption}>Выбрано: {file}</p>
        </section>
        <section>
          <h2>Настройки и модель</h2>
          <Switch checked={enabled} onChange={setEnabled}>
            Пример переключателя
          </Switch>
          <p className={styles.caption}>Этот переключатель меняет только пример.</p>
          <div className={styles.model}>
            <ModelPicker />
          </div>
          <h2>Голос</h2>
          <VoiceOrb active label="Пример состояния записи" />
          <p className={styles.caption}>Микрофон не включён.</p>
        </section>
        <section>
          <h2>Процесс работы</h2>
          <AgentPipeline
            steps={[
              { id: "plan", title: "План задачи", status: "completed" },
              {
                id: "draft",
                title: "Создание файлов",
                status: "running",
                detail: "Пример отображения активного этапа"
              },
              { id: "review", title: "Проверка результата", status: "pending" }
            ]}
          />
          <ShiningText>Подготавливаю ответ…</ShiningText>
        </section>
        <section>
          <h2>Сообщения системы</h2>
          <SystemMessage kind="info">Файлы добавлены к запросу.</SystemMessage>
          <SystemMessage kind="warning">Проверьте изменения перед публикацией.</SystemMessage>
          <SystemMessage>Соединение прервано. Черновик сохранён.</SystemMessage>
        </section>
      </div>
      <section>
        <h2>Код и результаты</h2>
        <CodeFiles
          files={[
            { name: "app.ts", content: 'export const greeting = "Kosmora";\n' },
            { name: "README.md", content: "# Kosmora\n\nОдно пространство для работы.\n" }
          ]}
        />
        <ChatResponse
          content="**Готово.** План сохранён, следующий шаг — проверить результат."
          assistant
          complete
          onFollowUp={setFollowUp}
        />
        {followUp && <p className={styles.caption}>Подготовленный запрос: {followUp}</p>}
      </section>
      <section>
        <h2>Тарифы · заготовка для будущего</h2>
        <PricingTable plans={[]} />
      </section>
    </main>
  );
}
