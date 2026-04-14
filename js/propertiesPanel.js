// Properties Panel – right-side panel for customizing a selected part's properties.

const PropertiesPanel = (() => {
  let container    = null;
  let currentPart  = null; // reference to the live placedPart object

  function init(containerEl) {
    container = containerEl;
    showEmpty();
  }

  // Called when selection changes (passes live placed part object or null)
  function showPart(placed) {
    currentPart = placed;
    if (!placed) { showEmpty(); return; }
    const def = getPartDef(placed.type);
    if (!def) { showEmpty(); return; }
    render(placed, def);
  }

  function showEmpty() {
    currentPart = null;
    container.innerHTML = `
      <div class="props-empty">
        <div class="props-empty-icon">
          <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>
          </svg>
        </div>
        <p>Select a part<br>to customize it</p>
        <p class="props-hint">Press <kbd>R</kbd> to rotate<br><kbd>Del</kbd> to delete</p>
      </div>
    `;
  }

  function render(placed, def) {
    const rotDeg = Math.round(((placed.rotation || 0) * 180 / Math.PI + 3600)) % 360;

    let html = `
      <div class="props-header">
        <div class="props-part-name">${def.label}</div>
        <div class="props-part-desc">${def.metadata.description}</div>
      </div>

      <div class="props-section">
        <div class="props-section-title">Transform</div>
        <div class="props-field">
          <label>Rotation</label>
          <div class="props-range-row">
            <input type="range" min="0" max="355" step="5"
              value="${rotDeg}" data-prop="__rotation" data-unit="°">
            <span class="props-val">${rotDeg}°</span>
          </div>
          <div class="props-rotate-btns">
            <button data-rot="-5">-5°</button>
            <button data-rot="-45">-45°</button>
            <button data-rot="45">+45°</button>
            <button data-rot="5">+5°</button>
          </div>
        </div>
      </div>
    `;

    if (def.props && def.props.length > 0) {
      html += `<div class="props-section"><div class="props-section-title">Properties</div>`;
      for (const pd of def.props) {
        const val = placed.props?.[pd.key] ?? pd.default;
        html += renderField(pd, val);
      }
      html += `</div>`;
    }

    // Snap info
    const localSPs = getEffectiveSnapPoints(placed, def);
    html += `
      <div class="props-section">
        <div class="props-section-title">Snap Points</div>
        <div class="props-snap-info">${localSPs.length} connection point${localSPs.length !== 1 ? 's' : ''}</div>
      </div>
    `;

    container.innerHTML = html;
    wireEvents(placed);
  }

  function renderField(pd, currentVal) {
    if (pd.type === 'text') {
      const escaped = String(currentVal || '').replace(/"/g, '&quot;');
      return `
        <div class="props-field">
          <label>${pd.label}</label>
          <input type="text" class="props-text-input" value="${escaped}"
            placeholder="${pd.placeholder || ''}" data-prop="${pd.key}" maxlength="20">
        </div>
      `;
    }
    if (pd.type === 'range') {
      return `
        <div class="props-field">
          <label>${pd.label}${pd.unit ? ` <em>(${pd.unit})</em>` : ''}</label>
          <div class="props-range-row">
            <input type="range" min="${pd.min}" max="${pd.max}" step="${pd.step}"
              value="${currentVal}" data-prop="${pd.key}" data-unit="${pd.unit || ''}">
            <span class="props-val">${currentVal}${pd.unit || ''}</span>
          </div>
        </div>
      `;
    }
    return '';
  }

  function wireEvents(placed) {
    // Text inputs — use notifyConfigOnly to avoid rebuilding the panel (which
    // would destroy this input and lose focus mid-typing).
    container.querySelectorAll('input[type="text"].props-text-input').forEach(input => {
      const prop = input.dataset.prop;
      const bc = (typeof BuildCanvas3D !== 'undefined' && BuildCanvas3D) ? BuildCanvas3D : BuildCanvas;
      input.addEventListener('input', () => {
        if (!placed.props) placed.props = {};
        placed.props[prop] = input.value;
        if (bc.notifyConfigOnly) bc.notifyConfigOnly();
        else bc.notifyPropChanged();
      });
    });

    // Sliders
    container.querySelectorAll('input[type="range"]').forEach(input => {
      const valEl = input.nextElementSibling;
      const unit  = input.dataset.unit || '';
      const prop  = input.dataset.prop;

      input.addEventListener('input', () => {
        const v = parseFloat(input.value);
        if (valEl) valEl.textContent = v + unit;

        if (prop === '__rotation') {
          placed.rotation = v * Math.PI / 180;
          // Re-sync if changed from drag handle
        } else {
          if (!placed.props) placed.props = {};
          placed.props[prop] = v;
        }
        ((typeof BuildCanvas3D !== 'undefined' && BuildCanvas3D) ? BuildCanvas3D : BuildCanvas).notifyPropChanged();
      });
    });

    // Quick rotation buttons
    container.querySelectorAll('[data-rot]').forEach(btn => {
      btn.addEventListener('click', () => {
        const delta = parseFloat(btn.dataset.rot) * Math.PI / 180;
        placed.rotation = ((placed.rotation || 0) + delta + Math.PI * 2) % (Math.PI * 2);
        ((typeof BuildCanvas3D !== 'undefined' && BuildCanvas3D) ? BuildCanvas3D : BuildCanvas).notifyPropChanged();
        // Refresh panel to update slider (render calls wireEvents internally)
        render(placed, getPartDef(placed.type));
      });
    });
  }

  // Called when the rotation handle changes the angle externally so the slider stays in sync
  function syncRotation(placed) {
    if (!container || currentPart?.id !== placed?.id) return;
    const slider = container.querySelector('input[data-prop="__rotation"]');
    const valEl  = slider?.nextElementSibling;
    if (!slider) return;
    const deg = Math.round(((placed.rotation || 0) * 180 / Math.PI + 3600)) % 360;
    slider.value = deg;
    if (valEl) valEl.textContent = deg + '°';
  }

  return { init, showPart, syncRotation };
})();
