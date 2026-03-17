
      const APP_CONFIG = {
        WORKER_BASE_URL: "https://playready-worker.iamsangmin.workers.dev",
        MAX_PDF_BYTES: 50 * 1024 * 1024,
        ETA_SECONDS: {
          start: 240,
          bgg: 180,
          pdf: 120,
          "pdf-skip": 90,
          ai: 45,
          done: 0
        }
      };

      const FUN_MESSAGES = [
        "BGG 포럼의 열띤 토론을 읽고 있습니다...",
        "규칙서를 꼼꼼히 번역하고 있습니다...",
        "헷갈리기 쉬운 예외 규칙을 모아보는 중입니다...",
        "처음 설명할 때 막히지 않도록 문장을 다듬고 있습니다...",
        "플레이어들이 자주 물어본 질문을 정리하고 있습니다..."
      ];

      const state = {
        currentScreen: "input",
        currentStage: "start",
        abortController: null,
        etaSeconds: APP_CONFIG.ETA_SECONDS.start,
        etaTimer: null,
        funTimer: null,
        funIndex: 0,
        result: null,
        selectedUploads: {
          rulebook: null,
          faq: null,
          extras: []
        }
      };

      const elements = {
        screens: {
          input: document.getElementById("screen-input"),
          progress: document.getElementById("screen-progress"),
          result: document.getElementById("screen-result")
        },
        gameName: document.getElementById("gameName"),
        bggId: document.getElementById("bggId"),
        pdfFile: document.getElementById("pdfFile"),
        faqPdfFile: document.getElementById("faqPdfFile"),
        extraFiles: document.getElementById("extraFiles"),
        pdfMeta: document.getElementById("pdfMeta"),
        faqPdfMeta: document.getElementById("faqPdfMeta"),
        extraMeta: document.getElementById("extraMeta"),
        clearPdfButton: document.getElementById("clearPdfButton"),
        clearFaqPdfButton: document.getElementById("clearFaqPdfButton"),
        clearExtraButton: document.getElementById("clearExtraButton"),
        inputError: document.getElementById("inputError"),
        startButton: document.getElementById("startButton"),
        progressTitle: document.getElementById("progressTitle"),
        progressSubtitle: document.getElementById("progressSubtitle"),
        progressFill: document.getElementById("progressFill"),
        progressMessage: document.getElementById("progressMessage"),
        etaBox: document.getElementById("etaBox"),
        funBox: document.getElementById("funBox"),
        progressError: document.getElementById("progressError"),
        cancelButton: document.getElementById("cancelButton"),
        resultTitle: document.getElementById("resultTitle"),
        resultSubtitle: document.getElementById("resultSubtitle"),
        resultMeta: document.getElementById("resultMeta"),
        previewA: document.getElementById("previewA"),
        previewB: document.getElementById("previewB"),
        tabA: document.getElementById("tabA"),
        tabB: document.getElementById("tabB"),
        downloadA: document.getElementById("downloadA"),
        downloadB: document.getElementById("downloadB"),
        restartButton: document.getElementById("restartButton"),
        stepBgg: document.getElementById("step-bgg"),
        stepPdf: document.getElementById("step-pdf"),
        stepAi: document.getElementById("step-ai")
      };

      elements.pdfFile.addEventListener("change", () =>
        handlePdfSelection(elements.pdfFile, elements.pdfMeta, "룰북 PDF")
      );
      elements.faqPdfFile.addEventListener("change", () =>
        handlePdfSelection(elements.faqPdfFile, elements.faqPdfMeta, "FAQ/정오표 PDF")
      );
      elements.extraFiles.addEventListener("change", handleExtraSelection);
      elements.pdfFile.addEventListener("change", () =>
        syncPdfSelection(elements.pdfFile, elements.pdfMeta, elements.clearPdfButton, "rulebook", "룰북 PDF")
      );
      elements.faqPdfFile.addEventListener("change", () =>
        syncPdfSelection(elements.faqPdfFile, elements.faqPdfMeta, elements.clearFaqPdfButton, "faq", "FAQ/정오표 PDF")
      );
      elements.extraFiles.addEventListener("change", syncExtraSelection);
      elements.clearPdfButton.addEventListener("click", () =>
        clearSelectedUpload("rulebook", elements.pdfFile, elements.pdfMeta, elements.clearPdfButton, "룰북 PDF")
      );
      elements.clearFaqPdfButton.addEventListener("click", () =>
        clearSelectedUpload("faq", elements.faqPdfFile, elements.faqPdfMeta, elements.clearFaqPdfButton, "FAQ/정오표 PDF")
      );
      elements.clearExtraButton.addEventListener("click", clearExtraSelection);
      elements.startButton.addEventListener("click", startGeneration);
      elements.cancelButton.addEventListener("click", cancelGeneration);
      elements.tabA.addEventListener("click", () => activateTab("A"));
      elements.tabB.addEventListener("click", () => activateTab("B"));
      elements.downloadA.addEventListener("click", () => downloadHtml("A"));
      elements.downloadB.addEventListener("click", () => downloadHtml("B"));
      elements.restartButton.addEventListener("click", resetToStart);

      function showScreen(name) {
        Object.entries(elements.screens).forEach(([key, node]) => {
          node.classList.toggle("is-active", key === name);
        });
        state.currentScreen = name;
      }

      function getEmptyFileMessage(label) {
        return `아직 선택한 ${label}가 없습니다.`;
      }

      function syncPdfSelection(fileInput, metaNode, clearButton, kind, label) {
        clearInputError();
        const file = fileInput.files[0];
        if (!file) {
          return;
        }

        if (file.size > APP_CONFIG.MAX_PDF_BYTES) {
          clearSelectedUpload(kind, fileInput, metaNode, clearButton, label);
          showInputError(`${label}는 최대 50MB까지 업로드할 수 있습니다. 더 작은 파일로 다시 선택해주세요.`);
          return;
        }

        state.selectedUploads[kind] = file;
        metaNode.textContent = `${file.name} | ${(file.size / 1024 / 1024).toFixed(2)}MB`;
        clearButton.classList.remove("hidden");
        fileInput.value = "";
      }

      function syncExtraSelection() {
        const files = Array.from(elements.extraFiles.files || []);
        if (!files.length) {
          return;
        }

        state.selectedUploads.extras = files;
        elements.extraMeta.textContent = `${files.length}개 파일 선택됨 | ${files
          .map((file) => file.name)
          .join(", ")}`;
        elements.clearExtraButton.classList.remove("hidden");
        elements.extraFiles.value = "";
      }

      function clearSelectedUpload(kind, inputNode, metaNode, clearButton, label) {
        state.selectedUploads[kind] = null;
        inputNode.value = "";
        metaNode.textContent = getEmptyFileMessage(label);
        clearButton.classList.add("hidden");
      }

      function clearExtraSelection() {
        state.selectedUploads.extras = [];
        elements.extraFiles.value = "";
        elements.extraMeta.textContent = "추가 자료를 선택하지 않아도 됩니다.";
        elements.clearExtraButton.classList.add("hidden");
      }

      function resetUploadSelections() {
        clearSelectedUpload("rulebook", elements.pdfFile, elements.pdfMeta, elements.clearPdfButton, "룰북 PDF");
        clearSelectedUpload("faq", elements.faqPdfFile, elements.faqPdfMeta, elements.clearFaqPdfButton, "FAQ/정오표 PDF");
        clearExtraSelection();
      }

      function handlePdfSelection(fileInput, metaNode, label) {
        clearInputError();
        const file = fileInput.files[0];
        if (!file) {
          metaNode.textContent = `아직 선택한 ${label}가 없습니다.`;
          return;
        }

        if (file.size > APP_CONFIG.MAX_PDF_BYTES) {
          fileInput.value = "";
          metaNode.textContent = `아직 선택한 ${label}가 없습니다.`;
          showInputError(`${label}는 최대 50MB까지 업로드할 수 있습니다. 더 작은 파일로 다시 선택해주세요.`);
          return;
        }

        metaNode.textContent = `${file.name} | ${(file.size / 1024 / 1024).toFixed(2)}MB`;
      }

      function handleExtraSelection() {
        const files = Array.from(elements.extraFiles.files || []);
        if (!files.length) {
          elements.extraMeta.textContent = "추가 자료를 선택하지 않아도 됩니다.";
          return;
        }

        elements.extraMeta.textContent = `${files.length}개 파일 선택됨 | ${files
          .map((file) => file.name)
          .join(", ")}`;
      }

      async function startGeneration() {
        clearInputError();
        const gameName = elements.gameName.value.trim();
        const bggId = elements.bggId.value.trim();
        const pdfFile = state.selectedUploads.rulebook;
        const faqPdfFile = state.selectedUploads.faq;
        const extraFiles = [...state.selectedUploads.extras];

        if (!gameName) {
          showInputError("게임 이름을 먼저 입력해주세요. 예: 아크노바 (Ark Nova)");
          return;
        }

        if (!bggId) {
          showInputError("BGG 게임 ID를 입력해주세요.");
          return;
        }

        if (pdfFile && pdfFile.size > APP_CONFIG.MAX_PDF_BYTES) {
          showInputError("룰북 PDF는 최대 50MB까지 업로드할 수 있습니다.");
          return;
        }

        if (faqPdfFile && faqPdfFile.size > APP_CONFIG.MAX_PDF_BYTES) {
          showInputError("FAQ/정오표 PDF는 최대 50MB까지 업로드할 수 있습니다.");
          return;
        }

        elements.startButton.disabled = true;
        showScreen("progress");
        resetProgressUi();
        startFunMessages();

        try {
          const payload = await buildRequestPayload({
            gameName,
            bggId,
            pdfFile,
            faqPdfFile,
            extraFiles
          });
          await streamGeneration(payload);
        } catch (error) {
          showProgressError(error.message || "요청을 준비하는 중 오류가 발생했습니다.");
          elements.startButton.disabled = false;
        }
      }

      async function buildRequestPayload({ gameName, bggId, pdfFile, faqPdfFile, extraFiles }) {
        const pdfBase64 = pdfFile ? await readFileAsDataUrl(pdfFile) : "";
        const faqPdfBase64 = faqPdfFile ? await readFileAsDataUrl(faqPdfFile) : "";

        const additionalMaterials = await Promise.all(
          extraFiles.slice(0, 5).map(async (file) => ({
            fileName: file.name,
            mimeType: file.type || guessMimeType(file.name),
            textContent: await extractAdditionalMaterialText(file)
          }))
        );

        return {
          gameName,
          bggId,
          pdfBase64,
          pdfFileName: pdfFile ? pdfFile.name : "",
          pdfMimeType: pdfFile ? pdfFile.type || "application/pdf" : "application/pdf",
          faqPdfBase64,
          faqPdfFileName: faqPdfFile ? faqPdfFile.name : "",
          faqPdfMimeType: faqPdfFile ? faqPdfFile.type || "application/pdf" : "application/pdf",
          additionalMaterials
        };
      }

      async function streamGeneration(payload) {
        state.abortController = new AbortController();
        const response = await fetch(`${APP_CONFIG.WORKER_BASE_URL}/api/generate/stream`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify(payload),
          signal: state.abortController.signal
        });

        if (!response.ok || !response.body) {
          const message = await extractErrorMessage(response);
          throw new Error(message);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder("utf-8");
        let buffer = "";

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          let separatorIndex = buffer.indexOf("\n\n");
          while (separatorIndex !== -1) {
            const chunk = buffer.slice(0, separatorIndex);
            buffer = buffer.slice(separatorIndex + 2);
            handleSseChunk(chunk);
            separatorIndex = buffer.indexOf("\n\n");
          }
        }
      }

      function handleSseChunk(chunk) {
        if (!chunk.trim()) return;
        const lines = chunk.split("\n");
        let eventName = "message";
        const dataLines = [];

        for (const line of lines) {
          if (line.startsWith("event:")) {
            eventName = line.slice(6).trim();
          } else if (line.startsWith("data:")) {
            dataLines.push(line.slice(5).trim());
          }
        }

        let parsed = {};
        try {
          parsed = JSON.parse(dataLines.join("\n") || "{}");
        } catch {
          parsed = { message: dataLines.join("\n") };
        }

        if (eventName === "progress") {
          updateProgress(parsed);
          return;
        }

        if (eventName === "result") {
          completeWithResult(parsed.data || parsed);
          return;
        }

        if (eventName === "error") {
          showProgressError(parsed.message || "처리 중 오류가 발생했습니다.");
        }
      }

      function updateProgress(payload) {
        const stage = payload.stage || state.currentStage;
        state.currentStage = stage;

        const stageMap = {
          start: {
            title: "요청을 정리하고 있습니다",
            percent: 8,
            subtitle: "업로드한 정보를 차분히 확인하는 중입니다."
          },
          bgg: {
            title: "BGG 데이터를 수집하고 있습니다",
            percent: 34,
            subtitle: "포럼, FAQ, 질문 글을 모으는 단계입니다."
          },
          pdf: {
            title: "PDF를 분석하고 있습니다",
            percent: 64,
            subtitle: "텍스트 구조와 이미지를 정리하는 단계입니다."
          },
          "pdf-skip": {
            title: "PDF 없이 BGG 중심으로 진행합니다",
            percent: 70,
            subtitle: "룰북 PDF가 없어도 문서 생성을 계속 진행합니다."
          },
          ai: {
            title: "한국어 문서를 생성하고 있습니다",
            percent: 90,
            subtitle: "용어를 통일하고 문장을 다듬는 중입니다."
          }
        };

        const info = stageMap[stage] || stageMap.start;
        elements.progressTitle.textContent = info.title;
        elements.progressSubtitle.textContent = info.subtitle;
        elements.progressFill.style.width = `${info.percent}%`;
        elements.progressMessage.textContent = payload.message || "현재 상태를 정리하고 있습니다.";
        resetEtaForStage(stage);
        paintStageChips(stage);
      }

      function paintStageChips(stage) {
        const order = ["bgg", "pdf", "ai"];
        const stepMap = {
          bgg: elements.stepBgg,
          pdf: elements.stepPdf,
          ai: elements.stepAi
        };

        order.forEach((key, index) => {
          const node = stepMap[key];
          node.classList.remove("is-current", "is-done");
          const currentIndex = stage === "pdf-skip" ? 1 : order.indexOf(stage);
          if (currentIndex > index) node.classList.add("is-done");
          if ((stage === "pdf-skip" && key === "pdf") || stage === key) node.classList.add("is-current");
        });

        if (stage === "ai") {
          elements.stepBgg.classList.add("is-done");
          elements.stepPdf.classList.add("is-done");
        }
      }

      function resetEtaForStage(stage) {
        state.etaSeconds = APP_CONFIG.ETA_SECONDS[stage] ?? 120;
        renderEta();
        if (!state.etaTimer) {
          state.etaTimer = window.setInterval(() => {
            if (state.etaSeconds > 0) state.etaSeconds -= 1;
            renderEta();
          }, 1000);
        }
      }

      function renderEta() {
        if (state.etaSeconds <= 0) {
          elements.etaBox.textContent = "예상 남은 시간: 거의 끝났습니다.";
          return;
        }

        const minutes = Math.floor(state.etaSeconds / 60);
        const seconds = state.etaSeconds % 60;
        elements.etaBox.textContent = `예상 남은 시간: ${minutes}분 ${String(seconds).padStart(2, "0")}초`;
      }

      function startFunMessages() {
        stopTimers();
        elements.funBox.textContent = FUN_MESSAGES[0];
        state.funTimer = window.setInterval(() => {
          state.funIndex = (state.funIndex + 1) % FUN_MESSAGES.length;
          elements.funBox.textContent = FUN_MESSAGES[state.funIndex];
        }, 3200);
      }

      function stopTimers() {
        if (state.etaTimer) {
          clearInterval(state.etaTimer);
          state.etaTimer = null;
        }
        if (state.funTimer) {
          clearInterval(state.funTimer);
          state.funTimer = null;
        }
      }

      function resetProgressUi() {
        state.currentStage = "start";
        state.funIndex = 0;
        elements.progressError.classList.add("hidden");
        elements.progressError.textContent = "";
        elements.progressFill.style.width = "8%";
        elements.progressTitle.textContent = "문서를 준비하고 있습니다";
        elements.progressSubtitle.textContent = "첫 요청을 정리하는 중입니다. 잠시만 기다려주세요.";
        elements.progressMessage.textContent = "작업이 시작되면 여기에서 자세한 상태를 알려드립니다.";
        paintStageChips("start");
        resetEtaForStage("start");
      }

      function completeWithResult(data) {
        stopTimers();
        elements.progressFill.style.width = "100%";
        state.result = data;
        renderResult(data);
        elements.startButton.disabled = false;
        showScreen("result");
      }

      function renderResult(data) {
        const titleGame = data.gameName || "보드게임";
        elements.resultTitle.textContent = `${titleGame} 문서 생성 완료`;
        elements.resultSubtitle.textContent =
          "문서 A와 문서 B를 탭으로 바꿔가며 읽거나 HTML 파일로 내려받을 수 있습니다.";
        elements.previewA.innerHTML = data.documentAHtml || "<p>문서 A 결과가 없습니다.</p>";
        elements.previewB.innerHTML = data.documentBHtml || "<p>문서 B 결과가 없습니다.</p>";
        elements.resultMeta.innerHTML = "";

        const pills = [
          `${data.meta?.forumCount || 0}개 포럼 묶음`,
          `${data.meta?.imageCount || 0}개 이미지`,
          `${(data.glossary || []).length}개 용어`
        ];

        pills.forEach((label) => {
          const span = document.createElement("span");
          span.className = "pill";
          span.textContent = label;
          elements.resultMeta.appendChild(span);
        });

        activateTab("A");
      }

      function activateTab(which) {
        const isA = which === "A";
        elements.tabA.classList.toggle("is-active", isA);
        elements.tabB.classList.toggle("is-active", !isA);
        elements.tabA.setAttribute("aria-selected", String(isA));
        elements.tabB.setAttribute("aria-selected", String(!isA));
        elements.previewA.classList.toggle("hidden", !isA);
        elements.previewB.classList.toggle("hidden", isA);
      }

      function downloadHtml(which) {
        if (!state.result) return;
        const htmlBody = which === "A" ? state.result.documentAHtml : state.result.documentBHtml;
        const gameName = sanitizeFileName(state.result.gameName || "playready");
        const fileName = `${gameName}-${which === "A" ? "study-doc" : "teach-doc"}.html`;

        const fullHtml = `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(state.result.gameName || "playready")} - 문서 ${which}</title>
  <style>
    body { margin: 0; padding: 28px; background: #f6f0e3; color: #2f2418; font-family: "Noto Sans KR", sans-serif; line-height: 1.75; }
    main { max-width: 980px; margin: 0 auto; background: #fffaf0; border-radius: 24px; padding: 28px; box-shadow: 0 24px 60px rgba(70, 44, 19, 0.12); }
    img { max-width: 100%; height: auto; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border: 1px solid rgba(117, 90, 51, 0.18); padding: 10px 12px; }
    blockquote { margin: 18px 0; padding: 14px 18px; border-left: 4px solid rgba(159, 79, 43, 0.4); background: rgba(255, 245, 232, 0.8); }
  </style>
</head>
<body>
  <main>${htmlBody || ""}</main>
</body>
</html>`;

        const blob = new Blob([fullHtml], { type: "text/html;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = fileName;
        anchor.click();
        URL.revokeObjectURL(url);
      }

      function cancelGeneration() {
        if (state.abortController) {
          state.abortController.abort();
        }
        stopTimers();
        elements.startButton.disabled = false;
        showScreen("input");
        showInputError("문서 생성을 취소했습니다. 입력값은 그대로 남아 있으니 다시 시작하시면 됩니다.");
      }

      function resetToStart() {
        stopTimers();
        state.result = null;
        showScreen("input");
        clearInputError();
      }

      function showInputError(message) {
        elements.inputError.textContent = message;
        elements.inputError.classList.remove("hidden");
      }

      function clearInputError() {
        elements.inputError.textContent = "";
        elements.inputError.classList.add("hidden");
      }

      function showProgressError(message) {
        stopTimers();
        elements.progressError.textContent = message;
        elements.progressError.classList.remove("hidden");
        elements.startButton.disabled = false;
      }

      function cancelGeneration() {
        if (state.abortController) {
          state.abortController.abort();
        }
        state.abortController = null;
        stopTimers();
        resetUploadSelections();
        elements.startButton.disabled = false;
        showScreen("input");
        showInputError("문서 생성을 취소했습니다. 파일은 다시 첨부하도록 초기화했습니다.");
      }

      function resetToStart() {
        stopTimers();
        state.abortController = null;
        state.result = null;
        resetUploadSelections();
        showScreen("input");
        clearInputError();
      }

      function showProgressError(message) {
        stopTimers();
        state.abortController = null;
        resetUploadSelections();
        elements.progressError.textContent = message;
        elements.progressError.classList.remove("hidden");
        elements.startButton.disabled = false;
      }

      function readFileAsDataUrl(file) {
        return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result || ""));
          reader.onerror = () => reject(new Error("파일을 읽는 중 문제가 발생했습니다."));
          reader.readAsDataURL(file);
        });
      }

      function readFileAsText(file) {
        return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result || ""));
          reader.onerror = () => reject(new Error("추가 자료를 읽는 중 문제가 발생했습니다."));
          reader.readAsText(file, "utf-8");
        });
      }

      async function extractAdditionalMaterialText(file) {
        const type = file.type || guessMimeType(file.name);
        const isTextLike =
          type.startsWith("text/") ||
          ["application/json", "text/markdown", "application/xml"].includes(type) ||
          /\.(txt|md|json|csv|html|htm)$/i.test(file.name);

        if (!isTextLike) {
          return `[첨부 파일: ${file.name}] 이 파일 형식은 본 버전에서 텍스트 자동 추출을 지원하지 않아 파일명만 참고합니다.`;
        }

        const text = await readFileAsText(file);
        return text.slice(0, 40000);
      }

      async function extractErrorMessage(response) {
        try {
          const data = await response.json();
          return data?.error?.message || "요청 처리 중 오류가 발생했습니다.";
        } catch {
          return "요청 처리 중 오류가 발생했습니다.";
        }
      }

      function guessMimeType(fileName) {
        const lower = fileName.toLowerCase();
        if (lower.endsWith(".md")) return "text/markdown";
        if (lower.endsWith(".json")) return "application/json";
        if (lower.endsWith(".csv")) return "text/csv";
        if (lower.endsWith(".html") || lower.endsWith(".htm")) return "text/html";
        if (lower.endsWith(".txt")) return "text/plain";
        if (lower.endsWith(".pdf")) return "application/pdf";
        return "application/octet-stream";
      }

      function sanitizeFileName(value) {
        return String(value).replace(/[\\/:*?"<>|]/g, "-").trim() || "playready";
      }

      function escapeHtml(value) {
        return String(value)
          .replaceAll("&", "&amp;")
          .replaceAll("<", "&lt;")
          .replaceAll(">", "&gt;")
          .replaceAll('"', "&quot;");
      }
    