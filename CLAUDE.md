\# Règles Book'nPay



\- Claude peut committer son travail en local, au fil de l'eau.

\- Claude ne pousse jamais et n'ouvre jamais de PR : Pierre exécute lui-même

&#x20; tout push / PR, après relecture des commits.

\- Ces règles sont appliquées techniquement par .claude/settings.local.json

&#x20; (deny sur git push et gh pr) + un hook PreToolUse

&#x20; (.claude/hooks/block-git-write.ps1) qui inspecte les commandes composées.



