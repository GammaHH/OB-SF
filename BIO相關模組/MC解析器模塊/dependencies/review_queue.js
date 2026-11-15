// ============================================================
// Minecraft BIO Generation Review Queue
// Pure state helpers. Does not write BIO or alter recipe data.
// ============================================================

const SCHEMA_VERSION = 1;
const QUEUE_STATUSES = new Set(["PENDING", "IN_REVIEW", "READY"]);

function createReviewQueue(options = {}) {
    const previous = options.previousQueue ?? null;
    const sameSource = previous?.sourceFingerprint === options.sourceFingerprint;
    const previousByTarget = new Map(
        (sameSource ? previous.targets ?? [] : [])
            .map(entry => [entry.target, entry])
    );
    const targets = [...(options.targets ?? [])]
        .sort((left, right) => left.target.localeCompare(right.target))
        .map(entry => {
            const old = previousByTarget.get(entry.target);
            const status = old && QUEUE_STATUSES.has(old.status)
                ? old.status
                : "PENDING";
            return {
                target: entry.target,
                status,
                reasons: {
                    blockedCycles: entry.reasons?.blockedCycles ?? 0,
                    recipe: entry.reasons?.recipe ?? 0,
                    tag: entry.reasons?.tag ?? 0,
                    alternative: entry.reasons?.alternative ?? 0
                },
                baseReview: old?.baseReview ?? entry.baseReview,
                recipeReview: old?.recipeReview ?? entry.recipeReview
            };
        });
    if (!targets.some(entry => entry.status === "IN_REVIEW")) {
        const firstPending = targets.find(entry => entry.status === "PENDING");
        if (options.activateFirst === true && firstPending) {
            firstPending.status = "IN_REVIEW";
        }
    }
    return {
        schemaVersion: SCHEMA_VERSION,
        sourceFingerprint: options.sourceFingerprint,
        scanScope: options.scanScope ?? "missing-bio",
        stats: {
            scannedTargets: options.scannedTargets ?? 0,
            existingBIO: options.existingBIO ?? 0,
            automaticReady: options.automaticReady ?? 0,
            pendingReview: targets.filter(entry => entry.status !== "READY").length
        },
        targets
    };
}

function currentReviewTarget(queue) {
    return (queue?.targets ?? []).find(entry => entry.status === "IN_REVIEW") ?? null;
}

function activateNextReviewTarget(queue) {
    const current = currentReviewTarget(queue);
    if (current) return current;
    const next = (queue?.targets ?? []).find(entry => entry.status === "PENDING") ?? null;
    if (next) next.status = "IN_REVIEW";
    return next;
}

function updateReviewTarget(queue, target, status) {
    if (!QUEUE_STATUSES.has(status)) {
        throw new TypeError(`未知 Review Queue status：${status}`);
    }
    const entry = (queue?.targets ?? []).find(candidate => candidate.target === target);
    if (!entry) throw new Error(`Review Queue 找不到 target：${target}`);
    entry.status = status;
    queue.stats.pendingReview = queue.targets.filter(candidate =>
        candidate.status !== "READY"
    ).length;
    return entry;
}

function focusReviewTarget(queue, target) {
    const entry = (queue?.targets ?? []).find(candidate =>
        candidate.target === target
    );
    if (!entry) throw new Error(`Review Queue 找不到 target：${target}`);
    for (const candidate of queue.targets) {
        if (candidate.target !== target && candidate.status === "IN_REVIEW") {
            candidate.status = "PENDING";
        }
    }
    entry.status = "IN_REVIEW";
    queue.stats.pendingReview = queue.targets.filter(candidate =>
        candidate.status !== "READY"
    ).length;
    return entry;
}

function renderReviewQueueMarkdown(queue) {
    const lines = [
        "---",
        "type: minecraft-review-queue",
        `schemaVersion: ${queue.schemaVersion}`,
        `sourceFingerprint: ${queue.sourceFingerprint}`,
        `scanScope: ${queue.scanScope}`,
        "---",
        "",
        "# Minecraft Decision Review Queue",
        "",
        `- Scanned Targets: ${queue.stats.scannedTargets}`,
        `- Existing BIO: ${queue.stats.existingBIO}`,
        `- Automatic Ready: ${queue.stats.automaticReady}`,
        `- Pending Review: ${queue.stats.pendingReview}`,
        "",
        "## Current Review",
        ""
    ];
    const current = currentReviewTarget(queue);
    if (current) {
        lines.push(
            `- Target: \`${current.target}\``,
            "- [[Minecraft Base Material Review]]",
            "- [[Minecraft Recipe Review]]"
        );
    } else {
        lines.push("- 無；執行 `node scripts/minecraft-review.cjs next`");
    }
    lines.push(
        "",
        "## Queue",
        "",
        "| Status | Target | Cycle | Recipe | Tag | Alternative |",
        "| --- | --- | ---: | ---: | ---: | ---: |"
    );
    for (const entry of queue.targets) {
        lines.push(
            `| ${entry.status} | \`${entry.target}\` | ` +
            `${entry.reasons.blockedCycles} | ${entry.reasons.recipe} | ` +
            `${entry.reasons.tag} | ${entry.reasons.alternative} |`
        );
    }
    if (queue.targets.length === 0) lines.push("| READY | 無待審核 Target | 0 | 0 | 0 | 0 |");
    lines.push("");
    return lines.join("\n");
}

module.exports = {
    REVIEW_QUEUE_SCHEMA_VERSION: SCHEMA_VERSION,
    QUEUE_STATUSES,
    createReviewQueue,
    currentReviewTarget,
    activateNextReviewTarget,
    updateReviewTarget,
    focusReviewTarget,
    renderReviewQueueMarkdown
};
