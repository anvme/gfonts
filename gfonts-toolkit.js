(function (global) {
  const sources = {
    tagsCsv: 'https://cdn.jsdelivr.net/gh/google/fonts@main/tags/all/families.csv',
    sortOrder: 'https://cdn.jsdelivr.net/gh/anvme/gfonts@main/popular-fonts-sort-order.json',
    previewTexts: 'https://cdn.jsdelivr.net/gh/anvme/gfonts@main/preview_texts.json'
  };

  const categories = [
    { key: 'feeling', label: 'Feeling', allLabel: 'All Feelings' },
    { key: 'appearance', label: 'Appearance', allLabel: 'All Appearances' },
    { key: 'calligraphy', label: 'Calligraphy', allLabel: 'All Calligraphy' },
    { key: 'serif', label: 'A Serif', allLabel: 'All Serif' },
    { key: 'sans', label: 'A Sans Serif', allLabel: 'All Sans Serif' },
    { key: 'writingSystem', label: 'Writing System', allLabel: 'All Writing Systems' },
    { key: 'seasonal', label: 'Seasonal', allLabel: 'All Seasons' }
  ];

  const tagCategories = categories.map(({ key }) => key).filter(key => key !== 'writingSystem');
  const defaultPreviewText = 'Almost before we knew it, we had left the ground.';
  const defaultSelectors = {
    loading: '#loading',
    previewInput: '#previewTextInput',
    fontSizeSlider: '#fontSizeSlider',
    fontSizeDisplay: '#fontSizeDisplay',
    filters: '#filters',
    clearButton: '#clearFiltersButton',
    grid: '#fontGrid',
    resultsCount: '#resultsCount',
    filterSelects: '.filter-select',
    fontPreviews: '.font-preview',
    resultsFooter: '[data-results-footer]'
  };

  async function loadCatalog(options = {}) {
    if (options.catalogUrl) return fetchJson(options.catalogUrl);

    const urls = { ...sources, ...(options.sources || {}) };
    const [csvText, apiData, previewTexts] = await Promise.all([
      fetchText(urls.tagsCsv),
      fetchJson(urls.sortOrder),
      fetchJson(urls.previewTexts)
    ]);

    return buildCatalog(parseCsv(csvText), apiData, previewTexts, options);
  }

  function buildCatalog(rows, apiData = {}, previewTexts = {}, options = {}) {
    const minScore = options.minScore ?? 20;
    const filterSets = Object.fromEntries(categories.map(({ key }) => [key, new Set()]));
    const subsetsMap = {};
    const rankMap = {};
    const fontMap = new Map();

    Object.entries(apiData || {}).forEach(([family, info]) => {
      subsetsMap[family] = info.s || [];
      rankMap[family] = info.r;
      subsetsMap[family].forEach(subset => filterSets.writingSystem.add(subset));
    });

    rows.forEach(row => {
      if (row.length < 4) return;
      const family = row[0];
      const tag = parseTag(row[2]);
      const score = parseInt(row[3], 10);
      if (isNaN(score) || score < minScore || !tag || !tag.value) return;

      if (!fontMap.has(family)) {
        fontMap.set(family, {
          family,
          ...Object.fromEntries(tagCategories.map(key => [key, []])),
          writingSystem: subsetsMap[family] || [],
          popularityRank: rankMap[family] ?? 999999,
          allTags: []
        });
      }

      const font = fontMap.get(family);
      if (!font[tag.category].includes(tag.value)) font[tag.category].push(tag.value);
      font.allTags.push(tag.value);
      filterSets[tag.category].add(tag.value);
    });

    const fonts = Array.from(fontMap.values()).sort((a, b) => a.popularityRank - b.popularityRank);
    const filters = Object.fromEntries(categories.map(({ key }) => [
      key,
      Array.from(filterSets[key]).sort().map(value => ({
        value,
        label: key === 'writingSystem' ? formatSubset(value) : value
      }))
    ]));

    return {
      categories,
      filters,
      fonts,
      previewTexts: { default: defaultPreviewText, ...previewTexts }
    };
  }

  function filterFonts(fonts, activeFilters) {
    return fonts.filter(font => {
      for (const [category, value] of Object.entries(activeFilters)) {
        if (!font[category]?.includes(value)) return false;
      }
      return true;
    });
  }

  function getPreviewText(catalog, writingSystem) {
    return catalog.previewTexts[writingSystem] || catalog.previewTexts.default;
  }

  function createPreviewApp(options = {}) {
    const documentRef = options.document || global.document;
    const selectors = { ...defaultSelectors, ...(options.selectors || {}) };
    const elements = getElements({ document: documentRef, selectors });
    const state = {
      catalog: null,
      filteredFonts: [],
      currentLimit: options.initialLimit || 50,
      filterSelects: []
    };

    const renderFilterControl = options.renderFilterControl || defaultRenderFilterControl;
    const renderFontCard = options.renderFontCard || defaultRenderFontCard;
    const renderFooter = options.renderFooter || defaultRenderFooter;

    async function init() {
      renderFilterControls();
      bindControls();

      try {
        state.catalog = await loadCatalog(options.loadOptions || {});
      } catch (error) {
        if (options.onLoadError) options.onLoadError(error, { elements, state });
        else if (elements.loading) elements.loading.textContent = 'Unable to load font catalog.';
        return;
      }

      populateDropdowns();
      renderFonts();
      if (elements.loading) elements.loading.style.display = 'none';
    }

    function renderFilterControls() {
      const fragment = documentRef.createDocumentFragment();
      categories.forEach((category, index) => {
        fragment.append(renderFilterControl({
          category,
          index,
          categories,
          createElement,
          document: documentRef
        }));
      });
      elements.filters.replaceChildren(fragment);
      state.filterSelects = Array.from(elements.filters.querySelectorAll(selectors.filterSelects));
    }

    function populateDropdowns() {
      state.catalog.categories.forEach(({ key }) => {
        const select = elements.filters.querySelector(`select[data-category="${key}"]`);
        state.catalog.filters[key].forEach(({ label, value }) => select.add(new Option(label, value)));
      });
    }

    function bindControls() {
      state.filterSelects.forEach(select => select.addEventListener('change', handleFilterChange));
      elements.clearButton?.addEventListener('click', resetFilters);
      elements.previewInput?.addEventListener('input', updatePreviewText);
      elements.fontSizeSlider?.addEventListener('input', updateFontSize);
    }

    function handleFilterChange(event) {
      state.currentLimit = options.initialLimit || 50;

      if (event.target.dataset.category === 'writingSystem' && elements.previewInput) {
        elements.previewInput.value = getPreviewText(state.catalog, event.target.value);
      }
      renderFonts();
    }

    function resetFilters() {
      state.filterSelects.forEach(select => select.value = '');
      state.currentLimit = options.initialLimit || 50;
      renderFonts();
    }

    function renderFonts() {
      const previewText = elements.previewInput?.value || state.catalog.previewTexts.default;
      const fontSize = `${elements.fontSizeSlider?.value || 40}px`;
      state.filteredFonts = filterFonts(state.catalog.fonts, getActiveFilters());

      if (elements.resultsCount) elements.resultsCount.textContent = `${state.filteredFonts.length} fonts`;
      const toRender = state.filteredFonts.slice(0, state.currentLimit);
      const fragment = documentRef.createDocumentFragment();

      syncFontLinks(toRender, { document: documentRef });
      toRender.forEach(font => fragment.append(renderFontCard({ font, previewText, fontSize, createElement })));
      fragment.append(renderFooter({
        filteredLength: state.filteredFonts.length,
        currentLimit: state.currentLimit,
        loadMore: loadMoreFonts,
        createElement
      }));
      elements.grid.replaceChildren(fragment);
    }

    function loadMoreFonts() {
      const start = state.currentLimit;
      state.currentLimit += options.initialLimit || 50;
      syncFontLinks(state.filteredFonts.slice(0, state.currentLimit), { document: documentRef });
      elements.grid.querySelector(selectors.resultsFooter)?.remove();

      const fragment = documentRef.createDocumentFragment();
      const previewText = elements.previewInput?.value || state.catalog.previewTexts.default;
      const fontSize = `${elements.fontSizeSlider?.value || 40}px`;
      state.filteredFonts.slice(start, state.currentLimit).forEach(font => {
        fragment.append(renderFontCard({ font, previewText, fontSize, createElement }));
      });
      fragment.append(renderFooter({
        filteredLength: state.filteredFonts.length,
        currentLimit: state.currentLimit,
        loadMore: loadMoreFonts,
        createElement
      }));
      elements.grid.append(fragment);
    }

    function getActiveFilters() {
      const activeFilters = {};
      state.filterSelects.forEach(select => {
        if (select.value) activeFilters[select.dataset.category] = select.value;
      });
      return activeFilters;
    }

    function updatePreviewText() {
      documentRef.querySelectorAll(selectors.fontPreviews).forEach(element => {
        element.textContent = elements.previewInput.value;
      });
    }

    function updateFontSize() {
      const size = `${elements.fontSizeSlider.value}px`;
      if (elements.fontSizeDisplay) elements.fontSizeDisplay.textContent = size;
      documentRef.querySelectorAll(selectors.fontPreviews).forEach(element => {
        element.style.fontSize = size;
      });
    }

    return { elements, init, loadMoreFonts, renderFonts, resetFilters, state };
  }

  function getElements(options = {}) {
    const documentRef = options.document || global.document;
    const selectors = { ...defaultSelectors, ...(options.selectors || {}) };

    return Object.fromEntries(Object.entries(selectors)
      .filter(([key]) => !['filterSelects', 'fontPreviews', 'resultsFooter'].includes(key))
      .map(([key, selector]) => [key, documentRef.querySelector(selector)]));
  }

  function syncFontLinks(fonts, options = {}) {
    const documentRef = options.document || global.document;
    const selector = options.selector || 'link[data-gfonts-preview]';
    const urls = buildFontCssUrls(fonts, options);
    const links = Array.from(documentRef.querySelectorAll(selector));

    urls.forEach((url, index) => {
      let link = links[index];
      if (!link) {
        link = documentRef.createElement('link');
        link.rel = 'stylesheet';
        link.dataset.gfontsPreview = '';
        documentRef.head.appendChild(link);
      }
      if (link.getAttribute('href') !== url) link.href = url;
    });

    links.slice(urls.length).forEach(link => link.remove());
  }

  function buildFontCssUrls(fonts, options = {}) {
    const batchSize = options.batchSize || 50;
    const urls = [];

    for (let i = 0; i < fonts.length; i += batchSize) {
      const families = fonts.slice(i, i + batchSize)
        .map(font => `family=${encodeURIComponent(font.family).replace(/%20/g, '+')}`)
        .join('&');
      urls.push(`https://fonts.googleapis.com/css2?${families}&display=swap`);
    }

    return urls;
  }

  function parseCsv(csvText) {
    if (!global.uDSV) throw new Error('CSV parser is not available.');
    const schema = global.uDSV.inferSchema(csvText);
    return global.uDSV.initParser(schema).typedArrs(csvText);
  }

  function parseTag(tagRaw) {
    if (tagRaw.startsWith('/Expressive/')) return { category: 'feeling', value: tagRaw.replace('/Expressive/', '') };
    if (tagRaw.startsWith('/Theme/') || tagRaw.startsWith('/Display/')) return tagFromPath(tagRaw, 'appearance');
    if (tagRaw.startsWith('/Script/')) return { category: 'calligraphy', value: tagRaw.replace('/Script/', '') };
    if (tagRaw.startsWith('/Serif/') || tagRaw.startsWith('/Slab/')) return tagFromPath(tagRaw, 'serif');
    if (tagRaw.startsWith('/Sans/')) return { category: 'sans', value: tagRaw.replace('/Sans/', '') };
    if (tagRaw.startsWith('/Seasonal/')) return { category: 'seasonal', value: tagRaw.replace('/Seasonal/', '') };
    return null;
  }

  function tagFromPath(tagRaw, category) {
    return { category, value: tagRaw.split('/')[2] || tagRaw.replace(/\//g, ' ').trim() };
  }

  function formatSubset(value) {
    return value.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
  }

  function fetchText(url) {
    return fetch(url).then(response => {
      if (!response.ok) throw new Error(`Request failed: ${url}`);
      return response.text();
    });
  }

  function fetchJson(url) {
    return fetch(url).then(response => {
      if (!response.ok) throw new Error(`Request failed: ${url}`);
      return response.json();
    });
  }

  function createElement(tag, className, text = '') {
    const element = global.document.createElement(tag);
    if (className) element.className = className;
    if (text) element.textContent = text;
    return element;
  }

  function defaultRenderFilterControl({ category, createElement }) {
    const wrapper = createElement('div', '');
    const label = createElement('label', '', category.label);
    const select = global.document.createElement('select');
    select.dataset.category = category.key;
    select.add(new Option(category.allLabel, ''));
    wrapper.append(label, select);
    return wrapper;
  }

  function defaultRenderFontCard({ font, previewText, fontSize, createElement }) {
    const card = createElement('div', '');
    const name = createElement('div', '', font.family);
    const preview = createElement('div', 'font-preview', previewText);
    preview.style.fontFamily = `"${font.family.replace(/"/g, '\\"')}", sans-serif`;
    preview.style.fontSize = fontSize;
    card.append(name, preview);
    return card;
  }

  function defaultRenderFooter({ filteredLength, currentLimit, loadMore, createElement }) {
    if (filteredLength <= currentLimit) return createElement('div', '', `Showing all ${filteredLength} results.`);

    const footer = createElement('div', '');
    const status = createElement('div', '', `Showing ${currentLimit} of ${filteredLength} results.`);
    const button = createElement('button', '', 'Load more');
    footer.dataset.resultsFooter = '';
    button.type = 'button';
    button.addEventListener('click', loadMore);
    footer.append(status, button);
    return footer;
  }

  global.GoogleFontsToolkit = Object.freeze({
    categories,
    createElement,
    createPreviewApp,
    defaultSelectors,
    sources,
    buildCatalog,
    buildFontCssUrls,
    filterFonts,
    formatSubset,
    getElements,
    getPreviewText,
    loadCatalog,
    syncFontLinks
  });
})(window);
