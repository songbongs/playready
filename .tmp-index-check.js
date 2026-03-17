
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
        "BGG ?щ읆???대씍 ?좊줎???쎄퀬 ?덉뒿?덈떎...",
        "洹쒖튃?쒕? 瑗쇨세??踰덉뿭?섍퀬 ?덉뒿?덈떎...",
        "?룰컝由ш린 ?ъ슫 ?덉쇅 洹쒖튃??紐⑥븘蹂대뒗 以묒엯?덈떎...",
        "泥섏쓬 ?ㅻ챸????留됲엳吏 ?딅룄濡?臾몄옣???ㅻ벉怨??덉뒿?덈떎...",
        "?뚮젅?댁뼱?ㅼ씠 ?먯＜ 臾쇱뼱蹂?吏덈Ц???뺣━?섍퀬 ?덉뒿?덈떎..."
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
        handlePdfSelection(elements.pdfFile, elements.pdfMeta, "猷곕턿 PDF")
      );
      elements.faqPdfFile.addEventListener("change", () =>
        handlePdfSelection(elements.faqPdfFile, elements.faqPdfMeta, "FAQ/?뺤삤??PDF")
      );
      elements.extraFiles.addEventListener("change", handleExtraSelection);
      elements.pdfFile.addEventListener("change", () =>
        syncPdfSelection(elements.pdfFile, elements.pdfMeta, elements.clearPdfButton, "rulebook", "猷곕턿 PDF")
      );
      elements.faqPdfFile.addEventListener("change", () =>
        syncPdfSelection(elements.faqPdfFile, elements.faqPdfMeta, elements.clearFaqPdfButton, "faq", "FAQ/?뺤삤??PDF")
      );
      elements.extraFiles.addEventListener("change", syncExtraSelection);
      elements.clearPdfButton.addEventListener("click", () =>
        clearSelectedUpload("rulebook", elements.pdfFile, elements.pdfMeta, elements.clearPdfButton, "猷곕턿 PDF")
      );
      elements.clearFaqPdfButton.addEventListener("click", () =>
        clearSelectedUpload("faq", elements.faqPdfFile, elements.faqPdfMeta, elements.clearFaqPdfButton, "FAQ/?뺤삤??PDF")
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
        return `?꾩쭅 ?좏깮??${label}媛 ?놁뒿?덈떎.`;
      }

      function syncPdfSelection(fileInput, metaNode, clearButton, kind, label) {
        clearInputError();
        const file = fileInput.files[0];
        if (!file) {
          return;
        }

        if (file.size > APP_CONFIG.MAX_PDF_BYTES) {
          clearSelectedUpload(kind, fileInput, metaNode, clearButton, label);
          showInputError(`${label}??理쒕? 50MB源뚯? ?낅줈?쒗븷 ???덉뒿?덈떎. ???묒? ?뚯씪濡??ㅼ떆 ?좏깮?댁＜?몄슂.`);
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
        elements.extraMeta.textContent = `${files.length}媛??뚯씪 ?좏깮??| ${files
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
        elements.extraMeta.textContent = "異붽? ?먮즺瑜??좏깮?섏? ?딆븘???⑸땲??";
        elements.clearExtraButton.classList.add("hidden");
      }

      function resetUploadSelections() {
        clearSelectedUpload("rulebook", elements.pdfFile, elements.pdfMeta, elements.clearPdfButton, "猷곕턿 PDF");
        clearSelectedUpload("faq", elements.faqPdfFile, elements.faqPdfMeta, elements.clearFaqPdfButton, "FAQ/?뺤삤??PDF");
        clearExtraSelection();
      }

      function handlePdfSelection(fileInput, metaNode, label) {
        clearInputError();
        const file = fileInput.files[0];
        if (!file) {
          metaNode.textContent = `?꾩쭅 ?좏깮??${label}媛 ?놁뒿?덈떎.`;
          return;
        }

        if (file.size > APP_CONFIG.MAX_PDF_BYTES) {
          fileInput.value = "";
          metaNode.textContent = `?꾩쭅 ?좏깮??${label}媛 ?놁뒿?덈떎.`;
          showInputError(`${label}??理쒕? 50MB源뚯? ?낅줈?쒗븷 ???덉뒿?덈떎. ???묒? ?뚯씪濡??ㅼ떆 ?좏깮?댁＜?몄슂.`);
          return;
        }

        metaNode.textContent = `${file.name} | ${(file.size / 1024 / 1024).toFixed(2)}MB`;
      }

      function handleExtraSelection() {
        const files = Array.from(elements.extraFiles.files || []);
        if (!files.length) {
          elements.extraMeta.textContent = "異붽? ?먮즺瑜??좏깮?섏? ?딆븘???⑸땲??";
          return;
        }

        elements.extraMeta.textContent = `${files.length}媛??뚯씪 ?좏깮??| ${files
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
          showInputError("寃뚯엫 ?대쫫??癒쇱? ?낅젰?댁＜?몄슂. ?? ?꾪겕?몃컮 (Ark Nova)");
          return;
        }

        if (!bggId) {
          showInputError("BGG 寃뚯엫 ID瑜??낅젰?댁＜?몄슂.");
          return;
        }

        if (pdfFile && pdfFile.size > APP_CONFIG.MAX_PDF_BYTES) {
          showInputError("猷곕턿 PDF??理쒕? 50MB源뚯? ?낅줈?쒗븷 ???덉뒿?덈떎.");
          return;
        }

        if (faqPdfFile && faqPdfFile.size > APP_CONFIG.MAX_PDF_BYTES) {
          showInputError("FAQ/?뺤삤??PDF??理쒕? 50MB源뚯? ?낅줈?쒗븷 ???덉뒿?덈떎.");
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
          showProgressError(error.message || "?붿껌??以鍮꾪븯??以??ㅻ쪟媛 諛쒖깮?덉뒿?덈떎.");
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
          showProgressError(parsed.message || "泥섎━ 以??ㅻ쪟媛 諛쒖깮?덉뒿?덈떎.");
        }
      }

      function legacyUpdateProgress(payload) {
        const stage = payload.stage || state.currentStage;
        state.currentStage = stage;

        const stageMap = {
          start: {
            title: "?붿껌???뺣━?섍퀬 ?덉뒿?덈떎",
            percent: 8,
            subtitle: "?낅줈?쒗븳 ?뺣낫瑜?李⑤텇???뺤씤?섎뒗 以묒엯?덈떎."
          },
          bgg: {
            title: "BGG ?곗씠?곕? ?섏쭛?섍퀬 ?덉뒿?덈떎",
            percent: 34,
            subtitle: "?щ읆, FAQ, 吏덈Ц 湲??紐⑥쑝???④퀎?낅땲??"
          },
          pdf: {
            title: "PDF瑜?遺꾩꽍?섍퀬 ?덉뒿?덈떎",
            percent: 64,
            subtitle: "?띿뒪??援ъ“? ?대?吏瑜??뺣━?섎뒗 ?④퀎?낅땲??"
          },
          "pdf-skip": {
            title: "PDF 없이 BGG 중심으로 진행합니다",
            percent: 70,
            subtitle: "猷곕턿 PDF媛 ?놁뼱??臾몄꽌 ?앹꽦??怨꾩냽 吏꾪뻾?⑸땲??"
          },
          ai: {
            title: "?쒓뎅??臾몄꽌瑜??앹꽦?섍퀬 ?덉뒿?덈떎",
            percent: 90,
            subtitle: "?⑹뼱瑜??듭씪?섍퀬 臾몄옣???ㅻ벉??以묒엯?덈떎."
          }
        };

        const info = stageMap[stage] || stageMap.start;
        elements.progressTitle.textContent = info.title;
        elements.progressSubtitle.textContent = info.subtitle;
        elements.progressFill.style.width = `${info.percent}%`;
        elements.progressMessage.textContent = payload.message || "?꾩옱 ?곹깭瑜??뺣━?섍퀬 ?덉뒿?덈떎.";
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

      function resetProgressUi() {
        state.currentStage = "start";
        state.funIndex = 0;
        elements.progressError.classList.add("hidden");
        elements.progressError.textContent = "";
        elements.progressFill.style.width = "8%";
        elements.progressTitle.textContent = "臾몄꽌瑜?以鍮꾪븯怨??덉뒿?덈떎";
        elements.progressSubtitle.textContent = "泥??붿껌???뺣━?섎뒗 以묒엯?덈떎. ?좎떆留?湲곕떎?ㅼ＜?몄슂.";
        elements.progressMessage.textContent = "?묒뾽???쒖옉?섎㈃ ?ш린?먯꽌 ?먯꽭???곹깭瑜??뚮젮?쒕┰?덈떎.";
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
        const titleGame = data.gameName || "蹂대뱶寃뚯엫";
        elements.resultTitle.textContent = `${titleGame} 臾몄꽌 ?앹꽦 ?꾨즺`;
        elements.resultSubtitle.textContent =
          "臾몄꽌 A? 臾몄꽌 B瑜???쑝濡?諛붽퓭媛硫??쎄굅??HTML ?뚯씪濡??대젮諛쏆쓣 ???덉뒿?덈떎.";
        elements.previewA.innerHTML = data.documentAHtml || "<p>臾몄꽌 A 寃곌낵媛 ?놁뒿?덈떎.</p>";
        elements.previewB.innerHTML = data.documentBHtml || "<p>臾몄꽌 B 寃곌낵媛 ?놁뒿?덈떎.</p>";
        elements.resultMeta.innerHTML = "";

        const pills = [
          `${data.meta?.forumCount || 0}媛??щ읆 臾띠쓬`,
          `${data.meta?.imageCount || 0}媛??대?吏`,
          `${(data.glossary || []).length}媛??⑹뼱`
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
  <title>${escapeHtml(state.result.gameName || "playready")} - 臾몄꽌 ${which}</title>
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
        showInputError("臾몄꽌 ?앹꽦??痍⑥냼?덉뒿?덈떎. ?낅젰媛믪? 洹몃?濡??⑥븘 ?덉쑝???ㅼ떆 ?쒖옉?섏떆硫??⑸땲??");
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
        showInputError("臾몄꽌 ?앹꽦??痍⑥냼?덉뒿?덈떎. ?뚯씪? ?ㅼ떆 泥⑤??섎룄濡?珥덇린?뷀뻽?듬땲??");
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
        elements.progressMessage.textContent = "?대쾲 ?쒕룄???꾨즺?섏? 紐삵뻽?듬땲??";
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
              <strong>?먮룞 ?ъ떆??以묒엯?덈떎</strong>
              <small>${escapeHtml(message || "泥??쒕룄 ?묐떟??遺덉븞?뺥빐 媛숈? ?④퀎瑜???踰????쒕룄?섍퀬 ?덉뒿?덈떎.")}</small>
            </div>
          `;
          return;
        }

        if (mode === "failed") {
          elements.workingIndicator.classList.add("hidden");
          elements.etaBox.classList.add("hidden");
          elements.heartbeatBox.classList.add("hidden");
          elements.funBox.classList.add("hidden");
          elements.progressSubtitle.textContent = "?대쾲 ?쒕룄???ш린??硫덉톬?듬땲?? ?꾨옒 ?덈궡瑜?蹂닿퀬 ?ㅼ떆 ?쒕룄?댁＜?몄슂.";
          return;
        }

        if (mode === "complete") {
          elements.workingIndicator.classList.add("is-complete");
          elements.workingIndicator.innerHTML = `
            <div class="working-spinner" aria-hidden="true"></div>
            <div>
              <strong>臾몄꽌 ?앹꽦???꾨즺?섏뿀?듬땲??/strong>
              <small>寃곌낵 ?붾㈃?쇰줈 ?대룞?⑸땲??</small>
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
            <strong>?꾩옱 ?묒뾽??怨꾩냽 吏꾪뻾 以묒엯?덈떎</strong>
            <small>${escapeHtml(message || "?ㅻ쪟媛 蹂댁씠吏 ?딅뒗?ㅻ㈃ 釉뚮씪?곗?瑜??レ? 留먭퀬 議곌툑 ??湲곕떎?ㅼ＜?몄슂.")}</small>
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
            title: "?붿껌???뺣━?섍퀬 ?덉뒿?덈떎",
            percent: 8,
            subtitle: "?낅줈?쒕맂 ?뺣낫? ?뚯씪???뺤씤?섎ŉ 泥??④퀎瑜?以鍮꾪븯怨??덉뒿?덈떎."
          },
          bgg: {
            title: "BGG ?곗씠?곕? ?섏쭛?섍퀬 ?덉뒿?덈떎",
            percent: 34,
            subtitle: "寃뚯엫 湲곕낯 ?뺣낫? 怨듦컻 ?좊줎 ?댁슜??紐⑥븘 李멸퀬 ?먮즺瑜?留뚮뱾怨??덉뒿?덈떎."
          },
          pdf: {
            title: "PDF瑜?遺꾩꽍?섍퀬 ?덉뒿?덈떎",
            percent: 64,
            subtitle: "猷곕턿怨?FAQ?먯꽌 ?띿뒪?몄? ?대?吏瑜??쎌뼱 臾몄꽌???먮즺濡??뺣━?섍퀬 ?덉뒿?덈떎."
          },
          "pdf-upload": {
            title: "猷곕턿 PDF瑜?遺꾩꽍 ?쒕쾭濡?蹂대궡怨??덉뒿?덈떎",
            percent: 52,
            subtitle: "猷곕턿 ?뚯씪???쒕쾭濡??꾩넚?섍퀬 ?덉뒿?덈떎."
          },
          "pdf-extract": {
            title: "猷곕턿 PDF?먯꽌 ?띿뒪?몄? ?대?吏瑜?異붿텧?섍퀬 ?덉뒿?덈떎",
            percent: 60,
            subtitle: "?섏씠吏 ?띿뒪?? ?대?吏, ?꾩튂 ?뺣낫瑜??쎈뒗 ???쒓컙??議곌툑 嫄몃┫ ???덉뒿?덈떎."
          },
          "pdf-faq-upload": {
            title: "FAQ/?뺤삤??PDF瑜?遺꾩꽍 ?쒕쾭濡?蹂대궡怨??덉뒿?덈떎",
            percent: 66,
            subtitle: "異붽? PDF媛 ?덉쑝硫??쒖꽌?濡??꾩넚?섏뿬 ?④퍡 遺꾩꽍?⑸땲??"
          },
          "pdf-faq-extract": {
            title: "FAQ/?뺤삤??PDF瑜?遺꾩꽍?섍퀬 ?덉뒿?덈떎",
            percent: 72,
            subtitle: "FAQ? ?뺤삤?쒖쓽 ?띿뒪?? ?대?吏, 蹂댁젙 洹쒖튃???뺣━?섍퀬 ?덉뒿?덈떎."
          },
          "pdf-merge": {
            title: "PDF 遺꾩꽍 寃곌낵瑜??뺣━?섍퀬 ?덉뒿?덈떎",
            percent: 78,
            subtitle: "猷곕턿怨?FAQ 遺꾩꽍 寃곌낵瑜??⑹퀜 臾몄꽌 ?앹꽦???щ즺濡?留덈Т由ы븯怨??덉뒿?덈떎."
          },
          "pdf-warning": {
            title: "PDF 遺꾩꽍??吏?곕릺??媛?ν븳 ?먮즺遺??怨꾩냽 吏꾪뻾?섍퀬 ?덉뒿?덈떎",
            percent: 74,
            subtitle: "PDF媛 ?ㅻ옒 嫄몃━硫??ㅻⅨ ?먮즺瑜?癒쇱? ?ъ슜???ㅼ쓬 ?④퀎濡??섏뼱媛묐땲??"
          },
          "pdf-skip": {
            title: "PDF 없이 BGG 중심으로 진행합니다",
            percent: 70,
            subtitle: "猷곕턿 PDF媛 ?놁뼱??湲곕낯 ?뺣낫? 怨듦컻 ?먮즺瑜?諛뷀깢?쇰줈 怨꾩냽 吏꾪뻾?⑸땲??"
          },
          ai: {
            title: "?쒓뎅??臾몄꽌瑜??앹꽦?섍퀬 ?덉뒿?덈떎",
            percent: 90,
            subtitle: "?⑹뼱瑜??듭씪?섍퀬 臾몄옣 援ъ“瑜??ㅻ벉??理쒖쥌 臾몄꽌瑜?留뚮뱶???④퀎?낅땲??"
          },
          "ai-retry": {
            title: "AI ?쒕쾭媛 ?좎떆 ?쇱옟?섏뿬 ?ㅼ떆 ?쒕룄?섍퀬 ?덉뒿?덈떎",
            percent: 92,
            subtitle: "???덉젙?곸쑝濡?寃곌낵瑜?諛쏄린 ?꾪빐 ?좎떆 ?ъ떆?꾪븯怨??덉뒿?덈떎."
          }
        };

        const info = stageMap[stage] || stageMap.start;
        elements.progressTitle.textContent = info.title;
        elements.progressSubtitle.textContent = info.subtitle;
        elements.progressFill.style.width = `${info.percent}%`;
        elements.progressMessage.textContent = payload.message || "?꾩옱 ?곹깭瑜??뺣━?섍퀬 ?덉뒿?덈떎.";
        elements.heartbeatBox.innerHTML =
          '<span class="heartbeat-dot" aria-hidden="true"></span>?묒뾽 ?쒕쾭? 怨꾩냽 ?듭떊 以묒엯?덈떎. ?좉퉸 硫덉텣 寃껋쿂??蹂댁뿬???대? ?묒뾽? 怨꾩냽?????덉뒿?덈떎.';

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
        elements.progressTitle.textContent = "臾몄꽌瑜?以鍮꾪븯怨??덉뒿?덈떎";
        elements.progressSubtitle.textContent = "泥??붿껌???뺣━?섎뒗 以묒엯?덈떎. ?좎떆留?湲곕떎?ㅼ＜?몄슂.";
        elements.progressMessage.textContent = "?묒뾽???쒖옉?섎㈃ ?ш린?먯꽌 ?먯꽭???곹깭瑜??뚮젮?쒕┰?덈떎.";
        elements.heartbeatBox.innerHTML =
          '<span class="heartbeat-dot" aria-hidden="true"></span>?묒뾽???쒖옉?섎㈃ ?쒕쾭? 怨꾩냽 ?듭떊 以묒씠?쇰뒗 ?쒖떆媛 ?ш린?먯꽌 蹂댁엯?덈떎.';
        paintStageChips("start");
        resetEtaForStage("start");
        renderElapsed();
      }

      const originalUpdateProgress = updateProgress;
      updateProgress = function patchedUpdateProgress(payload) {
        originalUpdateProgress(payload);
        const stage = payload.stage || state.currentStage;
        setProgressVisualState(
          stage === "ai-retry" ? "retrying" : "working",
          stage === "ai-retry" ? "AI ?쒕쾭媛 ?좎떆 ?쇱옟??媛숈? ?④퀎瑜??먮룞?쇰줈 ??踰????쒕룄?섍퀬 ?덉뒿?덈떎." : ""
        );
      };

      function readFileAsDataUrl(file) {
        return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result || ""));
          reader.onerror = () => reject(new Error("?뚯씪???쎈뒗 以?臾몄젣媛 諛쒖깮?덉뒿?덈떎."));
          reader.readAsDataURL(file);
        });
      }

      function readFileAsText(file) {
        return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result || ""));
          reader.onerror = () => reject(new Error("異붽? ?먮즺瑜??쎈뒗 以?臾몄젣媛 諛쒖깮?덉뒿?덈떎."));
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
          return `[泥⑤? ?뚯씪: ${file.name}] ???뚯씪 ?뺤떇? 蹂?踰꾩쟾?먯꽌 ?띿뒪???먮룞 異붿텧??吏?먰븯吏 ?딆븘 ?뚯씪紐낅쭔 李멸퀬?⑸땲??`;
        }

        const text = await readFileAsText(file);
        return text.slice(0, 40000);
      }

      async function extractErrorMessage(response) {
        try {
          const data = await response.json();
          return data?.error?.message || "?붿껌 泥섎━ 以??ㅻ쪟媛 諛쒖깮?덉뒿?덈떎.";
        } catch {
          return "?붿껌 泥섎━ 以??ㅻ쪟媛 諛쒖깮?덉뒿?덈떎.";
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
    
