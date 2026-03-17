
      const APP_CONFIG = {
        WORKER_BASE_URL: "https://playready-worker.iamsangmin.workers.dev",
        MAX_PDF_BYTES: 50 * 1024 * 1024,
        ETA_SECONDS: {
          start: 240,
          bgg: 180,
          pdf: 120,
          "pdf-upload": 110,
          "pdf-extract": 105,
          "pdf-faq-upload": 95,
          "pdf-faq-extract": 90,
          "pdf-merge": 75,
          "pdf-warning": 70,
          "pdf-skip": 90,
          ai: 45,
          "ai-retry": 35,
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
        elapsedSeconds: 0,
        elapsedTimer: null,
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
        workingIndicator: document.getElementById("workingIndicator"),
        etaBox: document.getElementById("etaBox"),
        elapsedBox: document.getElementById("elapsedBox"),
        heartbeatBox: document.getElementById("heartbeatBox"),
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
        elements.extraMeta.textContent = "추가 자료를 선택하지 않았습니다.";
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
          elements.extraMeta.textContent = "추가 자료를 선택하지 않았습니다.";
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
          showClientPreparationState({
            title: "업로드 파일을 읽고 있습니다",
            subtitle: "선택한 PDF와 추가 자료를 브라우저에서 안전하게 읽는 중입니다.",
            message: pdfFile || faqPdfFile || extraFiles.length
              ? "파일 크기에 따라 10초에서 1분 이상 걸릴 수 있습니다. 지금은 서버로 보내기 전 준비 단계입니다."
              : "첨부 파일이 없어 게임 이름과 BGG ID 중심으로 요청을 준비하고 있습니다.",
            percent: 12
          });
          const payload = await buildRequestPayload({
            gameName,
            bggId,
            pdfFile,
            faqPdfFile,
            extraFiles
          });
          showClientPreparationState({
            title: "작업 서버로 요청을 보내고 있습니다",
            subtitle: "준비한 자료를 서버에 전달하고 첫 진행 상태를 기다리는 중입니다.",
            message: "잠시 후 BGG, PDF, AI 단계 중 현재 위치가 아래에 표시됩니다.",
            percent: 18
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

      function legacyUpdateProgress(payload) {
        const stage = payload.stage || state.currentStage;
        state.currentStage = stage;

        const stageMap = {
          start: {
            title: "요청을 정리하고 있습니다",
            percent: 8,
            subtitle: "업로드한 정보와 입력값을 차분히 확인하고 있습니다."
          },
          bgg: {
            title: "BGG 데이터를 수집하고 있습니다",
            percent: 34,
            subtitle: "포럼, FAQ, 질문 글을 모아 참고 자료를 만들고 있습니다."
          },
          pdf: {
            title: "PDF를 분석하고 있습니다",
            percent: 64,
            subtitle: "텍스트 구조와 이미지를 정리하는 단계입니다."
          },
          "pdf-skip": {
            title: "PDF 없이 BGG 중심으로 진행합니다",
            percent: 70,
            subtitle: "룰북 PDF가 없어도 문서 생성은 계속 진행됩니다."
          },
          ai: {
            title: "학습용 문서를 생성하고 있습니다",
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

function renderElapsed() {
  const minutes = Math.floor(state.elapsedSeconds / 60);
  const seconds = state.elapsedSeconds % 60;
  elements.elapsedBox.textContent = `경과 시간: ${minutes}분 ${String(seconds).padStart(2, "0")}초`;
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

      function startFunMessages() {
        elements.funBox.textContent = "업로드한 자료와 입력값을 정리하고 있습니다...";
        if (state.funTimer) {
          clearInterval(state.funTimer);
        }
        state.funTimer = window.setInterval(() => {
          state.funIndex = (state.funIndex + 1) % FUN_MESSAGES.length;
          elements.funBox.textContent = FUN_MESSAGES[state.funIndex];
        }, 4500);
      }

      function resetProgressUi() {
        state.currentStage = "start";
        state.funIndex = 0;
        elements.progressError.classList.add("hidden");
        elements.progressError.textContent = "";
        elements.progressFill.style.width = "8%";
        elements.progressTitle.textContent = "입력 정보를 확인하고 있습니다";
        elements.progressSubtitle.textContent = "파일과 게임 정보를 확인한 뒤 작업 서버로 요청을 보낼 준비를 하고 있습니다.";
        elements.progressMessage.textContent = "첨부 파일이 있으면 브라우저에서 먼저 읽고 요청용 데이터로 바꾸는 중일 수 있습니다.";
        setProgressVisualState("working");
        paintStageChips("start");
        resetEtaForStage("start");
      }
      function completeWithResult(data) {
        stopTimers();
        state.abortController = null;
        setProgressVisualState("complete");
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
          "문서 A와 문서 B를 탭으로 바꿔가며 읽고, HTML 파일로 내려받을 수 있습니다.";
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

        const modelSummary = data.meta?.modelUsageSummary;
        if (modelSummary?.label) {
          const note = document.createElement("div");
          note.className = "result-model-note";

          const title = document.createElement("strong");
          title.textContent = modelSummary.label;
          note.appendChild(title);

          if (modelSummary.detail) {
            const detail = document.createElement("div");
            detail.textContent = modelSummary.detail;
            note.appendChild(detail);
          }

          const details = data.meta?.modelUsageDetails || [];
          if (details.length) {
            const list = document.createElement("ul");
            details.forEach((item) => {
              const li = document.createElement("li");
              li.textContent = item;
              list.appendChild(li);
            });
            note.appendChild(list);
          }

          elements.resultMeta.appendChild(note);
        }

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
    @page { size: A4; margin: 14mm 12mm 16mm; }
    * { box-sizing: border-box; }
    body { margin: 0; padding: 28px; background: #f6f0e3; color: #2f2418; font-family: "Noto Sans KR", sans-serif; line-height: 1.75; font-size: 15px; }
    main { max-width: 980px; margin: 0 auto; background: #fffaf0; border-radius: 24px; padding: 28px; box-shadow: 0 24px 60px rgba(70, 44, 19, 0.12); }
    section, article, figure, table, ul, ol, dl, blockquote { break-inside: avoid; page-break-inside: avoid; }
    h1, h2, h3, h4 { break-after: avoid; page-break-after: avoid; }
    h1 { font-size: 28px; margin-top: 0; }
    h2 { font-size: 22px; margin-top: 28px; padding-top: 8px; border-top: 1px solid rgba(117, 90, 51, 0.16); }
    h3 { font-size: 18px; margin-top: 22px; }
    img { max-width: 100%; height: auto; break-inside: avoid; page-break-inside: avoid; }
    figure { margin: 18px 0; }
    figcaption { margin-top: 8px; font-size: 12px; color: #5d4f3f; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    th, td { border: 1px solid rgba(117, 90, 51, 0.18); padding: 10px 12px; vertical-align: top; word-break: keep-all; }
    blockquote { margin: 18px 0; padding: 14px 18px; border-left: 4px solid rgba(159, 79, 43, 0.4); background: rgba(255, 245, 232, 0.8); }
    .auto-image-gallery, .action-flow-section { margin: 18px 0 24px; padding: 18px; border: 1px solid rgba(117, 90, 51, 0.14); border-radius: 18px; background: rgba(255, 248, 236, 0.88); }
    .auto-image-gallery__lead, .action-flow-section__lead { margin: 0 0 14px; color: #5d4f3f; }
    .auto-image-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; align-items: start; }
    .auto-image-grid--icons { grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 12px; }
    .auto-image-card { margin: 0; padding: 12px; border-radius: 14px; background: #fffdf8; border: 1px solid rgba(117, 90, 51, 0.1); }
    .auto-image-card img { width: 100%; border-radius: 10px; object-fit: contain; background: linear-gradient(180deg, #fffdfa, #f4ecdf); max-height: 220px; }
    .auto-image-card--icon { text-align: center; padding: 10px; }
    .auto-image-card--icon img { width: auto; max-width: 100%; max-height: 68px; margin: 0 auto; }
    .action-flow { display: flex; flex-direction: column; align-items: center; gap: 0; }
    .action-flow-node { width: min(100%, 660px); }
    .action-flow-step { padding: 16px 18px; border-radius: 18px; border: 1px solid rgba(117, 90, 51, 0.14); background: #fffdf8; box-shadow: 0 10px 24px rgba(81, 54, 23, 0.05); text-align: left; }
    .action-flow-node--primary .action-flow-step { background: rgba(216, 230, 247, 0.9); border-color: rgba(81, 126, 177, 0.28); }
    .action-flow-node--secondary .action-flow-step { background: rgba(231, 225, 249, 0.9); border-color: rgba(121, 98, 184, 0.24); }
    .action-flow-node--warning .action-flow-step { background: rgba(250, 237, 212, 0.92); border-color: rgba(184, 132, 47, 0.3); }
    .action-flow-node--neutral .action-flow-step { background: rgba(247, 243, 235, 0.96); }
    .action-flow-node--decision .action-flow-step { background: rgba(255, 242, 214, 0.96); border-color: rgba(184, 132, 47, 0.28); }
    .action-flow-node--merge .action-flow-step { background: rgba(219, 233, 220, 0.92); border-color: rgba(59, 111, 85, 0.24); }
    .action-flow-step strong { display: block; margin-bottom: 8px; color: #7f3614; }
    .action-flow-step p { margin: 0; color: #5d4f3f; }
    .action-flow-arrow { display: flex; align-items: center; justify-content: center; width: 100%; height: 30px; color: #9f4f2b; font-size: 18px; font-weight: 800; }
    .action-flow-branch { width: min(100%, 760px); padding: 14px 16px 6px; border-radius: 20px; border: 1px dashed rgba(121, 98, 184, 0.28); background: rgba(247, 243, 255, 0.92); }
    .action-flow-branch__label { margin-bottom: 12px; text-align: center; font-size: 12px; font-weight: 800; color: #6d5aa4; }
    .action-flow-branch__options { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
    .action-flow-branch-option { padding: 14px 14px 12px; border-radius: 16px; background: #fffdf8; border: 1px solid rgba(121, 98, 184, 0.18); box-shadow: 0 8px 18px rgba(81, 54, 23, 0.04); }
    .action-flow-branch-option strong { display: block; margin-bottom: 6px; color: #6d5aa4; }
    .action-flow-branch-option p { margin: 0; color: #5d4f3f; }
    @media print {
      body { padding: 0; background: #ffffff; font-size: 11pt; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      main { max-width: none; margin: 0; padding: 0; background: transparent; box-shadow: none; border-radius: 0; }
      h1 { font-size: 20pt; }
      h2 { font-size: 15pt; }
      h3 { font-size: 12pt; }
      .auto-image-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .auto-image-grid--icons { grid-template-columns: repeat(3, minmax(0, 1fr)); }
      .action-flow { display: flex; flex-direction: column; align-items: stretch; }
      .action-flow-node { width: 100%; }
      .action-flow-branch__options { grid-template-columns: repeat(3, minmax(0, 1fr)); }
    }
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
        showInputError("문서 생성이 취소되었습니다. 입력값은 그대로 남아 있으니 다시 시작하시면 됩니다.");
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
        showInputError("문서 생성이 취소되었습니다. 파일은 다시 첨부하도록 초기화했습니다.");
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
        setProgressVisualState("failed");
        elements.progressError.textContent = message;
        elements.progressError.classList.remove("hidden");
        elements.progressMessage.textContent = "이번 시도는 완료되지 못했습니다.";
        elements.startButton.disabled = false;
      }

      function setProgressVisualState(mode, message = "") {
        elements.workingIndicator.classList.remove("hidden", "is-retrying", "is-failed", "is-complete");
        elements.etaBox.classList.remove("hidden");
        elements.elapsedBox.classList.remove("hidden");
        elements.heartbeatBox.classList.remove("hidden");
        elements.funBox.classList.remove("hidden");

        if (mode === "retrying") {
          elements.workingIndicator.classList.add("is-retrying");
          elements.workingIndicator.innerHTML = `
            <div class="working-spinner" aria-hidden="true"></div>
            <div>
              <strong>자동 재시도 중입니다</strong>
              <small>${escapeHtml(message || "첫 시도 응답이 불안정해 같은 단계를 한 번 더 시도하고 있습니다.")}</small>
            </div>
          `;
          return;
        }

        if (mode === "failed") {
          elements.workingIndicator.classList.add("hidden");
          elements.etaBox.classList.add("hidden");
          elements.heartbeatBox.classList.add("hidden");
          elements.funBox.classList.add("hidden");
          elements.progressSubtitle.textContent = "이번 시도는 여기서 멈췄습니다. 아래 안내를 보고 다시 시도해주세요.";
          return;
        }

        if (mode === "complete") {
          elements.workingIndicator.classList.add("is-complete");
          elements.workingIndicator.innerHTML = `
            <div class="working-spinner" aria-hidden="true"></div>
            <div>
              <strong>문서 생성이 완료되었습니다</strong>
              <small>결과 화면으로 이동합니다.</small>
            </div>
          `;
          elements.etaBox.classList.add("hidden");
          elements.heartbeatBox.classList.add("hidden");
          elements.funBox.classList.add("hidden");
          return;
        }

        elements.workingIndicator.innerHTML = `
          <div class="working-spinner" aria-hidden="true"></div>
          <div>
            <strong>현재 작업이 계속 진행 중입니다</strong>
            <small>${escapeHtml(message || "오류가 보이지 않는다면 브라우저를 닫지 말고 조금 더 기다려주세요.")}</small>
          </div>
        `;
      }

      function normalizeStage(stage) {
        if (
          [
            "pdf",
            "pdf-upload",
            "pdf-extract",
            "pdf-faq-upload",
            "pdf-faq-extract",
            "pdf-merge",
            "pdf-warning",
            "pdf-skip"
          ].includes(stage)
        ) {
          return "pdf";
        }
        if (stage === "ai-retry") {
          return "ai";
        }
        return stage;
      }

      function updateProgress(payload) {
        const stage = payload.stage || state.currentStage;
        const previousStage = state.currentStage;
        state.currentStage = stage;

        const stageMap = {
          start: {
            title: "요청을 정리하고 있습니다",
            percent: 8,
            subtitle: "업로드한 정보와 파일을 확인하며 첫 단계를 준비하고 있습니다."
          },
          bgg: {
            title: "BGG 데이터를 수집하고 있습니다",
            percent: 34,
            subtitle: "게임 기본 정보와 공개 토론 내용을 모아 참고 자료를 만들고 있습니다."
          },
          pdf: {
            title: "PDF를 분석하고 있습니다",
            percent: 64,
            subtitle: "룰북과 FAQ에서 텍스트와 이미지를 읽어 문서용 자료로 정리하고 있습니다."
          },
          "pdf-upload": {
            title: "룰북 PDF를 분석 서버로 보내고 있습니다",
            percent: 52,
            subtitle: "룰북 파일을 서버로 안전하게 전송하고 있습니다."
          },
          "pdf-extract": {
            title: "룰북 PDF에서 텍스트와 이미지를 추출하고 있습니다",
            percent: 60,
            subtitle: "페이지 텍스트, 이미지, 위치 정보를 읽는 데 시간이 조금 걸릴 수 있습니다."
          },
          "pdf-faq-upload": {
            title: "FAQ/정오표 PDF를 분석 서버로 보내고 있습니다",
            percent: 66,
            subtitle: "추가 PDF가 있으면 순서대로 전송하여 함께 분석합니다."
          },
          "pdf-faq-extract": {
            title: "FAQ/정오표 PDF를 분석하고 있습니다",
            percent: 72,
            subtitle: "FAQ와 정오표의 텍스트, 이미지, 수정 규칙을 정리하고 있습니다."
          },
          "pdf-merge": {
            title: "PDF 분석 결과를 정리하고 있습니다",
            percent: 78,
            subtitle: "룰북과 FAQ 분석 결과를 합쳐 문서 생성용 재료로 마무리하고 있습니다."
          },
          "pdf-warning": {
            title: "PDF 분석이 지연되어 가능한 자료부터 계속 진행하고 있습니다",
            percent: 74,
            subtitle: "PDF가 오래 걸리면 다른 자료를 먼저 사용해 다음 단계로 넘어갑니다."
          },
          "pdf-skip": {
            title: "PDF 없이 BGG 중심으로 진행합니다",
            percent: 70,
            subtitle: "룰북 PDF가 없어도 기본 정보와 공개 자료를 바탕으로 계속 진행합니다."
          },
          ai: {
            title: "학습용 문서를 생성하고 있습니다",
            percent: 90,
            subtitle: "용어를 통일하고 문장 구조를 다듬어 최종 문서를 만들고 있습니다."
          },
          "ai-retry": {
            title: "AI 서버가 잠시 혼잡하여 다시 시도하고 있습니다",
            percent: 92,
            subtitle: "더 안정적으로 결과를 받기 위해 잠시 후 다시 시도하고 있습니다."
          }
        };

        const info = stageMap[stage] || stageMap.start;
        elements.progressTitle.textContent = info.title;
        elements.progressSubtitle.textContent = info.subtitle;
        elements.progressFill.style.width = `${info.percent}%`;
        elements.progressMessage.textContent = payload.message || "현재 상태를 정리하고 있습니다.";
        elements.heartbeatBox.innerHTML =
          '<span class="heartbeat-dot" aria-hidden="true"></span>작업 서버와 계속 통신 중입니다. 잠깐 멈춘 것처럼 보여도 내부 작업은 계속될 수 있습니다.';

        if (previousStage !== stage) {
          resetEtaForStage(stage);
        } else {
          renderEta();
        }

        paintStageChips(normalizeStage(stage));
      }

      function resetEtaForStage(stage) {
        state.etaSeconds = APP_CONFIG.ETA_SECONDS[stage] ?? 120;
        renderEta();

        if (!state.etaTimer) {
          state.etaTimer = window.setInterval(() => {
            if (state.etaSeconds > 0) {
              state.etaSeconds -= 1;
            }
            renderEta();
          }, 1000);
        }

        if (!state.elapsedTimer) {
          state.elapsedTimer = window.setInterval(() => {
            state.elapsedSeconds += 1;
            renderElapsed();
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

function renderElapsed() {
  const minutes = Math.floor(state.elapsedSeconds / 60);
  const seconds = state.elapsedSeconds % 60;
  elements.elapsedBox.textContent = `경과 시간: ${minutes}분 ${String(seconds).padStart(2, "0")}초`;
}

function stopTimers() {
        if (state.etaTimer) {
          clearInterval(state.etaTimer);
          state.etaTimer = null;
        }
        if (state.elapsedTimer) {
          clearInterval(state.elapsedTimer);
          state.elapsedTimer = null;
        }
        if (state.funTimer) {
          clearInterval(state.funTimer);
          state.funTimer = null;
        }
      }

      function resetProgressUi() {
        state.currentStage = "start";
        state.funIndex = 0;
        state.elapsedSeconds = 0;
        elements.progressError.classList.add("hidden");
        elements.progressError.textContent = "";
        elements.progressFill.style.width = "8%";
        elements.progressTitle.textContent = "입력 정보를 확인하고 있습니다";
        elements.progressSubtitle.textContent = "파일과 게임 정보를 확인한 뒤 작업 서버로 요청을 보낼 준비를 하고 있습니다.";
        elements.progressMessage.textContent = "첨부 파일이 있으면 브라우저에서 먼저 읽고 요청용 데이터로 바꾸는 중일 수 있습니다.";
        elements.heartbeatBox.innerHTML =
          '<span class="heartbeat-dot" aria-hidden="true"></span>아직 세부 단계 이벤트가 오기 전일 수 있습니다. 요청 준비가 끝나면 서버 진행 상태가 이어서 표시됩니다.';
        paintStageChips("start");
        resetEtaForStage("start");
        renderElapsed();
      }

      function showClientPreparationState({ title, subtitle, message, percent = 12 }) {
        elements.progressTitle.textContent = title;
        elements.progressSubtitle.textContent = subtitle;
        elements.progressMessage.textContent = message;
        elements.progressFill.style.width = `${percent}%`;
        elements.heartbeatBox.innerHTML =
          '<span class="heartbeat-dot" aria-hidden="true"></span>브라우저와 작업 서버가 요청을 준비 중입니다. 아직 세부 단계 이벤트가 오기 전일 수 있습니다.';
        setProgressVisualState("working", "오류가 없다면 요청을 준비하는 중일 가능성이 큽니다. 잠시만 더 기다려주세요.");
        paintStageChips("start");
      }

      const originalUpdateProgress = updateProgress;
      updateProgress = function patchedUpdateProgress(payload) {
        originalUpdateProgress(payload);
        const stage = payload.stage || state.currentStage;
        setProgressVisualState(
          stage === "ai-retry" ? "retrying" : "working",
          stage === "ai-retry" ? "AI 서버가 잠시 혼잡하여 같은 단계를 자동으로 한 번 더 시도하고 있습니다." : ""
        );
      };

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
          return `[첨부 파일: ${file.name}] 이 파일 형식은 현 버전에서 텍스트 자동 추출을 지원하지 않아 파일명만 참고합니다.`;
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
    