'use strict';

(() => {
  const measurementId = document.querySelector('meta[name="ga4-measurement-id"]')?.content.trim() || '';
  if (!/^G-[A-Z0-9]+$/i.test(measurementId)) return;

  const banner = document.querySelector('#analytics-consent');
  const settingsButton = document.querySelector('#analytics-settings');
  const acceptButton = document.querySelector('#analytics-accept');
  const declineButton = document.querySelector('#analytics-decline');
  if (!banner || !settingsButton || !acceptButton || !declineButton) return;

  const consentKey = `portfolio-analytics-consent:${measurementId}`;
  const gaDisabledKey = `ga-disable-${measurementId}`;
  const exploredProjects = new Set();
  const viewedProjects = new Set();
  let consent = 'unset';
  let tagInitialized = false;
  let trackingActive = false;
  let viewObservers = [];
  let viewStates = [];

  function pageLocation() {
    return window.location.origin + window.location.pathname;
  }

  function send(eventName, parameters) {
    if (consent !== 'granted' || window[gaDisabledKey] || typeof window.gtag !== 'function') return false;
    window.gtag('event', eventName, parameters);
    return true;
  }

  function projectId(project) {
    return project.id === 'ac-generator' ? 'ac_generator' : project.id;
  }

  function updateProjectTimer(state) {
    const isVisible = consent === 'granted' && document.visibilityState === 'visible'
      && state.titleVisible && state.subtitleVisible;
    if (!isVisible) {
      if (state.timer) window.clearTimeout(state.timer);
      state.timer = 0;
      return;
    }
    if (state.seen || state.timer) return;
    state.timer = window.setTimeout(() => {
      state.timer = 0;
      if (consent === 'granted' && document.visibilityState === 'visible'
        && state.titleVisible && state.subtitleVisible && !state.seen) {
        state.seen = send('project_view', { project_id: state.id });
        if (state.seen) viewedProjects.add(state.id);
      }
    }, 1000);
  }

  function recordProjectAction(event) {
    if (!(event.target instanceof Element)) return;
    const project = event.target.closest('article.project[id]');
    if (!project) return;
    const id = projectId(project);
    if (exploredProjects.has(id)) return;

    let action = '';
    if (event.type === 'click') {
      const summary = event.target.closest('summary');
      const button = event.target.closest('button');
      if (summary && project.contains(summary)) action = 'details';
      else if (button && project.contains(button)) {
        if (button.hasAttribute('data-generator-view')) action = 'generator_view';
        else if (button.hasAttribute('data-display') || button.hasAttribute('data-quota') || button.classList.contains('recharge-button')) action = 'quota_demo';
        else action = 'project_control';
      }
    } else if (event.type === 'input' && event.target.closest('input[type="range"]')) {
      action = 'range_control';
    } else if (event.type === 'pointerdown') {
      if (event.target.closest('model-viewer')) action = 'model_viewer';
      else if (event.target.closest('#generator-crank-hit')) action = 'generator_crank';
    }

    if (action && send('project_explore', { project_id: id, action })) exploredProjects.add(id);
  }

  function startTracking() {
    if (trackingActive) return;
    trackingActive = true;
    document.addEventListener('click', recordProjectAction);
    document.addEventListener('input', recordProjectAction);
    document.addEventListener('pointerdown', recordProjectAction);

    viewStates = [...document.querySelectorAll('article.project[id]')].flatMap(project => {
      const title = project.querySelector('.project-copy h3');
      const subtitle = project.querySelector('.project-subtitle');
      if (!title || !subtitle) return [];
      const id = projectId(project);
      const state = { id, titleVisible: false, subtitleVisible: false, timer: 0, seen: viewedProjects.has(id) };
      const observer = new IntersectionObserver(entries => {
        for (const entry of entries) {
          const visible = entry.isIntersecting && entry.intersectionRatio >= .5;
          if (entry.target === title) state.titleVisible = visible;
          if (entry.target === subtitle) state.subtitleVisible = visible;
        }
        updateProjectTimer(state);
      }, { threshold: [.5] });
      observer.observe(title);
      observer.observe(subtitle);
      viewObservers.push(observer);
      return [state];
    });
    document.addEventListener('visibilitychange', updateAllProjectTimers);
  }

  function updateAllProjectTimers() {
    for (const state of viewStates) updateProjectTimer(state);
  }

  function stopTracking() {
    if (!trackingActive) return;
    trackingActive = false;
    document.removeEventListener('click', recordProjectAction);
    document.removeEventListener('input', recordProjectAction);
    document.removeEventListener('pointerdown', recordProjectAction);
    document.removeEventListener('visibilitychange', updateAllProjectTimers);
    for (const observer of viewObservers) observer.disconnect();
    for (const state of viewStates) if (state.timer) window.clearTimeout(state.timer);
    viewObservers = [];
    viewStates = [];
  }

  function loadAnalytics() {
    window[gaDisabledKey] = false;
    if (!tagInitialized) {
      window.dataLayer = window.dataLayer || [];
      window.gtag = window.gtag || function() { window.dataLayer.push(arguments); };
      window.gtag('js', new Date());
      window.gtag('config', measurementId, {
        send_page_view: false,
        page_location: pageLocation(),
        allow_google_signals: false,
        allow_ad_personalization_signals: false
      });
      window.gtag('event', 'page_view', { page_location: pageLocation(), page_title: document.title });
      const tag = document.createElement('script');
      tag.async = true;
      tag.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`;
      document.head.appendChild(tag);
      tagInitialized = true;
    }
    startTracking();
  }

  function persistChoice(choice, returnFocus = false) {
    consent = choice;
    try { window.localStorage.setItem(consentKey, choice); } catch {}
    banner.hidden = true;
    if (returnFocus) settingsButton.focus({ preventScroll: true });
    if (choice === 'granted') loadAnalytics();
    else {
      window[gaDisabledKey] = true;
      stopTracking();
    }
  }

  settingsButton.hidden = false;
  settingsButton.addEventListener('click', () => {
    banner.hidden = false;
    acceptButton.focus({ preventScroll: true });
  });
  acceptButton.addEventListener('click', () => persistChoice('granted', true));
  declineButton.addEventListener('click', () => persistChoice('denied', true));

  let savedChoice = '';
  try { savedChoice = window.localStorage.getItem(consentKey) || ''; } catch {}
  if (savedChoice === 'granted') persistChoice('granted');
  else if (savedChoice === 'denied') {
    consent = 'denied';
    window[gaDisabledKey] = true;
  } else banner.hidden = false;
})();
