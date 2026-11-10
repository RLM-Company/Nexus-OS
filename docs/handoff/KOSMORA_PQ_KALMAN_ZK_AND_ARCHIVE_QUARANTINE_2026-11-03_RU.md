# KOSMORA / KOSWORK — WAVE 26 (MILESTONE 25/25): PRODUCT QUANTIZATION (32X VECTOR COMPRESSION), KALMAN-CUSUM DRIFT DETECTOR, ZERO-KNOWLEDGE COMMITMENTS & ARCHIVE QUARANTINE GUARD (2026-11-03)

## 1. Обзор реализованных систем (Wave 26 — Финальный рубеж 25/25)

1. **Product Quantization (PQ) 8-Subspace Vector Compressor & Asymmetric Distance Computation (`packages/db/src/product-quantization-vector-codec.ts`)**:
   - Сжимает 64-мерные `Float32` векторы (256 байт) в 8-байтные коды `Uint8Array` (**32-кратное сжатие оперативной памяти** специально для VPS с 1 ГБ ОЗУ).
   - Обучает кодовые книги подпространств методом Ллойда ($K$-means), вычисляет асимметричное расстояние (`searchAsymmetricTopK`) через предвычисленную таблицу $M \times K$ за 8 обращений к таблице на вектор и сохраняет кодовые книги в таблицу SQLite `kosmora_pq_codebooks` (миграция `0063`).

2. **Kalman Filter & Page's Two-Sided CUSUM Drift Detector (`packages/core/src/kalman-cusum-drift-detector.ts`)**:
   - Линейно-гауссовский одномерный фильтр Калмана (`observe`) для подавления шума телеметрии задержек и двусторонний кумулятивный детектор разладки Пейджа (`CUSUM`), мгновенно фиксирующий структурные скачки задержки провайдеров (`upward_spike` / `downward_drop`).

3. **Homomorphic Pedersen Commitments & Fiat-Shamir Zero-Knowledge Proof Verifier (`packages/core/src/zk-commitment-verifier.ts`)**:
   - Гомоморфные обязательства Педерсена $C = g^v h^r \pmod p$ с поддержкой гомоморфного сложения балансов/квот $C(v_1 + v_2) = C(v_1) \cdot C(v_2) \pmod p$ и неинтерактивных доказательств с нулевым разглашением (NIZK Sigma-протокол Фиата — Шамира `createProofOfOpening`, `verifyProofOfOpening`).

4. **Desktop Pre-Extraction ZIP Archive Quarantine Guard (`desktop/windows/ci/archive-quarantine-verifier.cjs`)**:
   - Анализирует бинарный каталог `Central Directory` и `EOCD` ZIP-архивов **до распаковки на диск**, блокируя атаки `Zip-Slip` (`../`, абсолютные пути), символьные ссылки (`UNIX mode 0120000`), архивные бомбы (`ratio > 100:1`) и вложенные исполняемые файлы (`.exe`, `.ps1`, `.bat`, `.lnk`).
