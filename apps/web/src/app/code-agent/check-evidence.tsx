export type CodeCheckEvidenceValue = {
  status: string;
  exitCode?: number | null;
  cleanupVerified?: boolean;
};
export function hasVerifiedCodeCheck(check: CodeCheckEvidenceValue | undefined): boolean {
  return check?.status === "passed" && check.exitCode === 0 && check.cleanupVerified === true;
}
export function CodeCheckEvidence({ check }: { check: CodeCheckEvidenceValue }) {
  return (
    <div>
      <p>
        Код завершения: {typeof check.exitCode === "number" ? check.exitCode : "не подтверждён"}.
      </p>
      <p>
        Очистка изолированной среды:{" "}
        {check.cleanupVerified === true ? "подтверждена" : "не подтверждена"}.
      </p>
      {check.status === "passed" && !hasVerifiedCodeCheck(check) && (
        <p role="alert">
          Успех проверки не подтверждён. Выполните проверку заново; публикация недоступна.
        </p>
      )}
    </div>
  );
}
