"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import styles from "./pay.module.css";

type PayStatus = "created" | "pending" | "succeeded" | "canceled";
type PayOrder = {
  id: string;
  customer_ref: string;
  plan_code: string;
  amount_minor: number;
  status: PayStatus;
  confirmation_url: string | null;
  provider_payment_id: string | null;
  created_at: string;
};
type PaySummary = {
  orders_total: number;
  awaiting_payment: number;
  succeeded_count: number;
  canceled_count: number;
  succeeded_gross_minor: number;
};

const rub = (minor: number): string =>
  new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB" }).format(minor / 100);

const stateLabels: Record<PayStatus, string> = {
  created: "Создан",
  pending: "Ожидает оплаты",
  succeeded: "Оплачен",
  canceled: "Отменён"
};

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  if (!response.ok) {
    // Never display provider or infrastructure internals to the operator.
    throw new Error(`Запрос отклонён (HTTP ${response.status})`);
  }
  return response.json() as Promise<T>;
}

export default function KosmoraPayPage() {
  const [summary, setSummary] = useState<PaySummary | null>(null);
  const [orders, setOrders] = useState<PayOrder[]>([]);
  const [busy, setBusy] = useState(false);
  const [verifying, setVerifying] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [created, setCreated] = useState<PayOrder | null>(null);
  const [customerRef, setCustomerRef] = useState("");
  const [planCode, setPlanCode] = useState("");
  const idempotencyKeyRef = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    const [overview, latest] = await Promise.all([
      api<PaySummary>("/api/v1/pay/summary"),
      api<{ items: PayOrder[] }>("/api/v1/pay/orders?limit=50")
    ]);
    setSummary(overview);
    setOrders(latest.items);
  }, []);

  useEffect(() => {
    void refresh().catch(() => setError("Не удалось загрузить данные платёжного ядра"));
  }, [refresh]);

  async function createOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setCreated(null);
    if (!idempotencyKeyRef.current) idempotencyKeyRef.current = crypto.randomUUID();
    try {
      const order = await api<PayOrder>("/api/v1/pay/checkout", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "Idempotency-Key": idempotencyKeyRef.current
        },
        body: JSON.stringify({ customer_ref: customerRef.trim(), plan_code: planCode.trim() })
      });
      setCreated(order);
      idempotencyKeyRef.current = null;
      await refresh();
    } catch {
      setError("Создать платёж не удалось. Проверь тариф и настройки эквайринга. При повторе запроса используется тот же ключ.");
    } finally {
      setBusy(false);
    }
  }

  async function verifyOrder(orderId: string) {
    setVerifying(orderId);
    setError("");
    try {
      await api<PayOrder>(`/api/v1/pay/orders/${encodeURIComponent(orderId)}/verify`, {
        method: "POST"
      });
      await refresh();
    } catch {
      setError("Подтверждение не получено. Оплата не будет засчитана без проверки у банка.");
    } finally {
      setVerifying(null);
    }
  }

  return (
    <main className={styles.container}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>KOSMORA / CONTROL CENTER</p>
          <h1>Kosmora Pay</h1>
          <p className={styles.subtitle}>Подписки и подтверждённые платежи. Без хранения данных карт.</p>
        </div>
        <nav className={styles.navigation} aria-label="Навигация">
          <Link href="/control-center">Управление</Link>
          <Link href="/">Главная</Link>
        </nav>
      </header>

      <section className={styles.cards} aria-label="Показатели">
        <article className={styles.card}>
          <span>Валовые подтверждённые оплаты</span>
          <strong>{summary ? rub(summary.succeeded_gross_minor) : "—"}</strong>
          <small>Не включает возвраты, комиссии и сверку с банком</small>
        </article>
        <article className={styles.card}>
          <span>Успешных платежей</span>
          <strong>{summary?.succeeded_count ?? "—"}</strong>
          <small>Подтверждены ответом провайдера</small>
        </article>
        <article className={styles.card}>
          <span>Ожидают оплаты</span>
          <strong>{summary?.awaiting_payment ?? "—"}</strong>
          <small>Не считаются выручкой</small>
        </article>
      </section>

      {error ? <p className={styles.error} role="alert">{error}</p> : null}

      <section className={styles.panel}>
        <div className={styles.panelHead}>
          <h2>Создать платёж</h2>
          <p>Только для администратора. Доступно после подключения продавца и тарифов.</p>
        </div>
        <form className={styles.form} onSubmit={(event) => void createOrder(event)}>
          <label>
            ID клиента в Kosmora
            <input value={customerRef} onChange={(event) => { setCustomerRef(event.target.value); idempotencyKeyRef.current = null; }}
              placeholder="user_123" required pattern="[A-Za-z0-9:_-]+" maxLength={128} />
          </label>
          <label>
            Код тарифа
            <input value={planCode} onChange={(event) => { setPlanCode(event.target.value); idempotencyKeyRef.current = null; }}
              placeholder="pro" required pattern="[A-Za-z0-9_-]+" maxLength={64} />
          </label>
          <button type="submit" disabled={busy}>{busy ? "Создание…" : "Создать ссылку"}</button>
        </form>
        {created?.confirmation_url ? (
          <p className={styles.created}>
            Заказ создан. <a href={created.confirmation_url} target="_blank" rel="noopener noreferrer">Перейти к оплате ↗</a>
          </p>
        ) : null}
      </section>

      <section className={styles.panel}>
        <div className={styles.panelHead}>
          <h2>Последние операции</h2>
          <button className={styles.secondary} type="button" onClick={() => void refresh().catch(() => setError("Не удалось обновить платежи"))}>
            Обновить
          </button>
        </div>
        <div className={styles.tableScroller}>
          <table className={styles.table}>
            <thead><tr><th>Клиент</th><th>Тариф</th><th>Сумма</th><th>Статус</th><th>Дата</th><th>Проверка</th></tr></thead>
            <tbody>
              {orders.map((order) => (
                <tr key={order.id}>
                  <td>{order.customer_ref}</td>
                  <td>{order.plan_code}</td>
                  <td>{rub(order.amount_minor)}</td>
                  <td>{stateLabels[order.status]}</td>
                  <td>{new Date(order.created_at).toLocaleString("ru-RU")}</td>
                  <td>
                    {order.provider_payment_id && order.status === "pending"
                      ? <button className={styles.secondary} type="button" disabled={verifying === order.id}
                          onClick={() => void verifyOrder(order.id)}>
                          {verifying === order.id ? "Проверяем…" : "Проверить у банка"}
                        </button>
                      : "—"}
                  </td>
                </tr>
              ))}
              {orders.length === 0 ? <tr><td colSpan={6} className={styles.empty}>Операций пока нет</td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>

      <p className={styles.footer}>Платёжный модуль не управляет банковским счётом. Для запуска необходимы эквайринг и фискализация.</p>
    </main>
  );
}
