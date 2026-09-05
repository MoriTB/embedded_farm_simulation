(() => {
  'use strict';

  const MODEL = Object.freeze({
    averageBodyMassKg: 60,
    intakeFractionPerDay: 0.02,
    troughCapacityKg: 40,
    initialMassKg: 18,
    refillThresholdKg: 12,
    refillTargetKg: 32,
    augerRateKgPerMinute: 4,
    adaptiveResponseMinutes: 1,
    fixedBatchKg: 4,
    fixedIntervalMinutes: 360,
    dayMinutes: 1440
  });

  const TASKS = Object.freeze([
    { name: 'Remove weight', periodMs: 800 },
    { name: 'LED', periodMs: 2600 },
    { name: 'Servo', periodMs: 2900 },
    { name: 'Load cell', periodMs: 3500 },
    { name: 'Add weight', periodMs: 4333 },
    { name: 'Buzzer', periodMs: 10000 }
  ]);

  const dom = {
    policy: document.querySelector('#policy'),
    flock: document.querySelector('#flock-size'),
    flockOutput: document.querySelector('#flock-output'),
    playback: document.querySelector('#playback'),
    run: document.querySelector('#run'),
    reset: document.querySelector('#reset'),
    massValue: document.querySelector('#mass-value'),
    massDetail: document.querySelector('#mass-detail'),
    coverageValue: document.querySelector('#coverage-value'),
    coverageDetail: document.querySelector('#coverage-detail'),
    bandValue: document.querySelector('#band-value'),
    clockValue: document.querySelector('#clock-value'),
    clockDetail: document.querySelector('#clock-detail'),
    grid: document.querySelector('#chart-grid'),
    labels: document.querySelector('#chart-axis-labels'),
    area: document.querySelector('#chart-area'),
    line: document.querySelector('#chart-line'),
    marker: document.querySelector('#chart-marker'),
    thresholdLine: document.querySelector('#threshold-line'),
    targetLine: document.querySelector('#target-line'),
    dayProgress: document.querySelector('#day-progress'),
    dayProgressFill: document.querySelector('#day-progress-fill'),
    systemState: document.querySelector('#system-state'),
    penCount: document.querySelector('#pen-count'),
    levelLabel: document.querySelector('#level-label'),
    levelTrack: document.querySelector('#level-track'),
    levelFill: document.querySelector('#level-fill'),
    eventText: document.querySelector('#event-text'),
    eventTime: document.querySelector('#event-time'),
    taskList: document.querySelector('#task-list'),
    comparisonList: document.querySelector('#comparison-list')
  };

  const chart = Object.freeze({ left: 49, right: 783, top: 14, bottom: 277 });
  const profileWeights = Array.from({ length: MODEL.dayMinutes }, (_, minute) => consumptionMultiplier(minute));
  const profileWeightSum = profileWeights.reduce((sum, value) => sum + value, 0);

  let state;
  let animationFrame = 0;
  let lastFrame = null;
  const taskViews = [];

  function consumptionMultiplier(minute) {
    const hour = minute / 60;
    if (hour < 5) return 0.18;
    if (hour < 6.5) return 0.9;
    if (hour < 9) return 2.65;
    if (hour < 15.5) return 0.62;
    if (hour < 16.5) return 1.0;
    if (hour < 19.5) return 2.45;
    if (hour < 22) return 0.72;
    return 0.22;
  }

  function dailyDemandKg(flockSize = Number(dom.flock.value)) {
    return flockSize * MODEL.averageBodyMassKg * MODEL.intakeFractionPerDay;
  }

  function demandAtMinute(minute, flockSize) {
    return dailyDemandKg(flockSize) * profileWeights[minute] / profileWeightSum;
  }

  function makeState(policy = dom.policy.value, flockSize = Number(dom.flock.value)) {
    return {
      policy,
      flockSize,
      farmMinute: 0,
      processedMinute: -1,
      massKg: MODEL.initialMassKg,
      requestedKg: 0,
      servedKg: 0,
      dispensedKg: 0,
      inBandMinutes: 0,
      minimumMassKg: MODEL.initialMassKg,
      pendingRefillAt: null,
      triggerMinute: null,
      refilling: false,
      responseTimes: [],
      history: [{ minute: 0, massKg: MODEL.initialMassKg }],
      controllerElapsedMs: 0,
      running: false,
      finished: false,
      latestEvent: 'Load cell initialized at 18.0 kg.',
      latestEventMinute: 0
    };
  }

  function formatClock(minute) {
    const safeMinute = Math.min(MODEL.dayMinutes, Math.max(0, Math.floor(minute)));
    const hours = Math.floor(safeMinute / 60) % 24;
    const minutes = safeMinute % 60;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  }

  function setEvent(simState, message, minute) {
    simState.latestEvent = message;
    simState.latestEventMinute = minute;
  }

  function addFeed(simState, amountKg, minute, reason) {
    const accepted = Math.max(0, Math.min(amountKg, MODEL.troughCapacityKg - simState.massKg));
    if (accepted <= 0) return 0;
    simState.massKg += accepted;
    simState.dispensedKg += accepted;
    setEvent(simState, `${reason} added ${accepted.toFixed(1)} kg.`, minute);
    return accepted;
  }

  function processMinute(simState, minute) {
    if (simState.policy === 'fixed' && minute % MODEL.fixedIntervalMinutes === 0) {
      addFeed(simState, MODEL.fixedBatchKg, minute, 'Scheduled refill');
    }

    const requested = demandAtMinute(minute, simState.flockSize);
    const served = Math.min(simState.massKg, requested);
    simState.massKg -= served;
    simState.requestedKg += requested;
    simState.servedKg += served;

    if (simState.policy === 'adaptive') {
      if (!simState.refilling && simState.pendingRefillAt === null && simState.massKg <= MODEL.refillThresholdKg) {
        simState.triggerMinute = minute;
        simState.pendingRefillAt = minute + MODEL.adaptiveResponseMinutes;
        setEvent(simState, `Low-feed threshold crossed at ${simState.massKg.toFixed(1)} kg.`, minute);
      }

      if (simState.pendingRefillAt !== null && minute >= simState.pendingRefillAt) {
        simState.refilling = true;
        simState.responseTimes.push(minute - simState.triggerMinute);
        simState.pendingRefillAt = null;
        setEvent(simState, 'Auger started after load-cell confirmation.', minute);
      }

      if (simState.refilling) {
        addFeed(simState, MODEL.augerRateKgPerMinute, minute, 'Adaptive refill');
        if (simState.massKg >= MODEL.refillTargetKg) {
          simState.refilling = false;
          simState.triggerMinute = null;
          setEvent(simState, `Target reached; auger stopped at ${simState.massKg.toFixed(1)} kg.`, minute);
        }
      }
    }

    if (simState.massKg >= MODEL.refillThresholdKg) simState.inBandMinutes += 1;
    simState.minimumMassKg = Math.min(simState.minimumMassKg, simState.massKg);
    if (minute % 6 === 0 || minute === MODEL.dayMinutes - 1) {
      simState.history.push({ minute: minute + 1, massKg: simState.massKg });
    }
  }

  function advanceTo(simState, targetMinute) {
    const boundedTarget = Math.min(MODEL.dayMinutes, targetMinute);
    const finalWholeMinute = Math.min(MODEL.dayMinutes - 1, Math.floor(boundedTarget));
    while (simState.processedMinute < finalWholeMinute) {
      simState.processedMinute += 1;
      processMinute(simState, simState.processedMinute);
    }
    simState.farmMinute = boundedTarget;
    if (boundedTarget >= MODEL.dayMinutes) {
      simState.finished = true;
      simState.running = false;
      setEvent(simState, `Farm day complete; ${simState.servedKg.toFixed(1)} kg of demand served.`, MODEL.dayMinutes);
    }
  }

  function runProjection(policy, flockSize) {
    const projection = makeState(policy, flockSize);
    advanceTo(projection, MODEL.dayMinutes);
    return {
      coverage: projection.requestedKg ? projection.servedKg / projection.requestedKg * 100 : 100,
      inBand: projection.inBandMinutes / MODEL.dayMinutes * 100,
      minimumMass: projection.minimumMassKg,
      dispensed: projection.dispensedKg
    };
  }

  function xScale(minute) {
    return chart.left + minute / MODEL.dayMinutes * (chart.right - chart.left);
  }

  function yScale(massKg) {
    return chart.bottom - Math.max(0, Math.min(MODEL.troughCapacityKg, massKg)) / MODEL.troughCapacityKg * (chart.bottom - chart.top);
  }

  function makeSvgElement(name, attributes = {}) {
    const element = document.createElementNS('http://www.w3.org/2000/svg', name);
    Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, String(value)));
    return element;
  }

  function initializeChart() {
    [0, 10, 20, 30, 40].forEach(value => {
      const y = yScale(value);
      dom.grid.appendChild(makeSvgElement('line', { x1: chart.left, y1: y, x2: chart.right, y2: y, class: 'chart-grid-line' }));
      const label = makeSvgElement('text', { x: chart.left - 11, y: y + 4, 'text-anchor': 'end', class: 'chart-axis-text' });
      label.textContent = `${value}`;
      dom.labels.appendChild(label);
    });

    [0, 360, 720, 1080, 1440].forEach(value => {
      const x = xScale(value);
      const label = makeSvgElement('text', { x, y: 301, 'text-anchor': value === 0 ? 'start' : value === 1440 ? 'end' : 'middle', class: 'chart-axis-text' });
      label.textContent = value === MODEL.dayMinutes
        ? '24:00'
        : `${String(Math.floor(value / 60)).padStart(2, '0')}:00`;
      dom.labels.appendChild(label);
    });

    const yUnit = makeSvgElement('text', { x: chart.left, y: 10, class: 'chart-axis-text' });
    yUnit.textContent = 'kg';
    dom.labels.appendChild(yUnit);

    [[dom.thresholdLine, MODEL.refillThresholdKg], [dom.targetLine, MODEL.refillTargetKg]].forEach(([line, value]) => {
      const y = yScale(value);
      line.setAttribute('x1', chart.left);
      line.setAttribute('x2', chart.right);
      line.setAttribute('y1', y);
      line.setAttribute('y2', y);
    });
  }

  function renderChart() {
    const points = state.history.slice();
    if (!points.length || points[points.length - 1].minute !== state.farmMinute) {
      points.push({ minute: state.farmMinute, massKg: state.massKg });
    }
    const linePath = points.map((point, index) => `${index ? 'L' : 'M'} ${xScale(point.minute).toFixed(2)} ${yScale(point.massKg).toFixed(2)}`).join(' ');
    const areaPath = `${linePath} L ${xScale(points[points.length - 1].minute).toFixed(2)} ${chart.bottom} L ${xScale(points[0].minute).toFixed(2)} ${chart.bottom} Z`;
    dom.line.setAttribute('d', linePath);
    dom.area.setAttribute('d', areaPath);
    dom.marker.setAttribute('cx', xScale(state.farmMinute));
    dom.marker.setAttribute('cy', yScale(state.massKg));
  }

  function initializeTasks() {
    TASKS.forEach(task => {
      const row = document.createElement('div');
      row.className = 'task-row';

      const name = document.createElement('span');
      name.className = 'task-name';
      name.textContent = task.name;

      const track = document.createElement('div');
      track.className = 'task-track';
      track.setAttribute('role', 'progressbar');
      track.setAttribute('aria-label', `${task.name} release period`);
      track.setAttribute('aria-valuemin', '0');
      track.setAttribute('aria-valuemax', String(task.periodMs));
      track.setAttribute('aria-valuenow', '0');
      const fill = document.createElement('span');
      fill.className = 'task-fill';
      fill.style.width = '0%';
      track.appendChild(fill);

      const time = document.createElement('span');
      time.className = 'task-time';

      row.append(name, track, time);
      dom.taskList.appendChild(row);
      taskViews.push({ task, track, fill, time });
    });
  }

  function renderTasks() {
    taskViews.forEach(({ task, track, fill, time }) => {
      const phase = state.controllerElapsedMs % task.periodMs;
      const remaining = task.periodMs - phase;
      track.setAttribute('aria-valuenow', String(Math.round(phase)));
      fill.style.width = `${phase / task.periodMs * 100}%`;
      time.textContent = `${(remaining / 1000).toFixed(2)} s`;
    });
  }

  function comparisonGroup(title, unit, adaptiveValue, baselineValue, maximum, formatter) {
    const group = document.createElement('div');
    group.className = 'comparison-group';
    const heading = document.createElement('div');
    heading.className = 'comparison-title';
    const titleText = document.createElement('span');
    titleText.textContent = title;
    const unitText = document.createElement('span');
    unitText.textContent = unit;
    heading.append(titleText, unitText);
    group.appendChild(heading);

    const pair = document.createElement('div');
    pair.className = 'comparison-pair';
    [['Adaptive', adaptiveValue, ''], ['Fixed', baselineValue, 'baseline']].forEach(([label, value, className]) => {
      const row = document.createElement('div');
      row.className = 'comparison-row';
      const name = document.createElement('span');
      name.textContent = label;
      const track = document.createElement('div');
      track.className = 'comparison-track';
      const fill = document.createElement('span');
      fill.className = `comparison-fill ${className}`.trim();
      fill.style.width = `${Math.max(0, Math.min(100, value / maximum * 100))}%`;
      track.appendChild(fill);
      const output = document.createElement('span');
      output.className = 'comparison-value';
      output.textContent = formatter(value);
      row.append(name, track, output);
      pair.appendChild(row);
    });
    group.appendChild(pair);
    return group;
  }

  function renderComparison() {
    const flockSize = Number(dom.flock.value);
    const adaptive = runProjection('adaptive', flockSize);
    const fixed = runProjection('fixed', flockSize);
    dom.comparisonList.replaceChildren(
      comparisonGroup('Demand served', '%', adaptive.coverage, fixed.coverage, 100, value => `${value.toFixed(1)}%`),
      comparisonGroup('Time in operating band', '%', adaptive.inBand, fixed.inBand, 100, value => `${value.toFixed(1)}%`),
      comparisonGroup('Minimum trough mass', 'kg', adaptive.minimumMass, fixed.minimumMass, MODEL.troughCapacityKg, value => `${value.toFixed(1)}`)
    );
  }

  function render() {
    const capacityPercent = state.massKg / MODEL.troughCapacityKg * 100;
    const coverage = state.requestedKg ? state.servedKg / state.requestedKg * 100 : 100;
    const elapsedWholeMinutes = Math.max(1, state.processedMinute + 1);
    const inBand = state.inBandMinutes / elapsedWholeMinutes * 100;
    const dayPercent = state.farmMinute / MODEL.dayMinutes * 100;

    dom.massValue.textContent = `${state.massKg.toFixed(1)} kg`;
    dom.massDetail.textContent = `${capacityPercent.toFixed(0)}% of capacity`;
    dom.coverageValue.textContent = `${coverage.toFixed(1)}%`;
    dom.coverageDetail.textContent = `${state.servedKg.toFixed(1)} / ${state.requestedKg.toFixed(1)} kg`;
    dom.bandValue.textContent = `${inBand.toFixed(1)}%`;
    dom.clockValue.textContent = formatClock(state.farmMinute);
    dom.clockDetail.textContent = `Day 01 · ${state.running ? 'running' : state.finished ? 'complete' : 'paused'}`;
    dom.penCount.textContent = `${state.flockSize} ewes`;
    dom.levelLabel.textContent = `${state.massKg.toFixed(1)} / ${MODEL.troughCapacityKg} kg`;
    dom.levelTrack.setAttribute('aria-valuenow', state.massKg.toFixed(1));
    dom.levelFill.style.width = `${Math.max(0, capacityPercent)}%`;
    dom.levelFill.classList.toggle('warning', state.massKg <= MODEL.refillThresholdKg && state.massKg > 4);
    dom.levelFill.classList.toggle('critical', state.massKg <= 4);
    dom.eventText.textContent = state.latestEvent;
    dom.eventTime.textContent = formatClock(state.latestEventMinute);
    dom.systemState.textContent = state.refilling ? 'Refilling' : state.pendingRefillAt !== null ? 'Confirming' : 'Monitoring';
    dom.systemState.classList.toggle('refilling', state.refilling || state.pendingRefillAt !== null);
    dom.dayProgress.setAttribute('aria-valuenow', String(Math.round(state.farmMinute)));
    dom.dayProgressFill.style.width = `${dayPercent}%`;
    dom.run.textContent = state.running ? 'Pause' : state.finished ? 'Run again' : 'Run day';

    renderChart();
    renderTasks();
  }

  function resetSimulation() {
    if (animationFrame) cancelAnimationFrame(animationFrame);
    state = makeState();
    advanceTo(state, 0);
    lastFrame = null;
    render();
    renderComparison();
  }

  function frame(timestamp) {
    if (!state.running) return;
    if (lastFrame === null) lastFrame = timestamp;
    const wallDeltaMs = Math.min(100, timestamp - lastFrame);
    lastFrame = timestamp;
    const playbackRatio = Number(dom.playback.value);
    const farmMinutesDelta = wallDeltaMs / 1000 * playbackRatio / 60;
    state.controllerElapsedMs += wallDeltaMs;
    advanceTo(state, state.farmMinute + farmMinutesDelta);
    render();
    if (state.running) animationFrame = requestAnimationFrame(frame);
  }

  dom.run.addEventListener('click', () => {
    if (state.finished) resetSimulation();
    state.running = !state.running;
    lastFrame = null;
    render();
    if (state.running) animationFrame = requestAnimationFrame(frame);
    else if (animationFrame) cancelAnimationFrame(animationFrame);
  });

  dom.reset.addEventListener('click', resetSimulation);
  dom.policy.addEventListener('change', resetSimulation);
  dom.flock.addEventListener('input', () => {
    dom.flockOutput.textContent = `${dom.flock.value} ewes`;
    resetSimulation();
  });

  initializeChart();
  initializeTasks();
  resetSimulation();
})();
