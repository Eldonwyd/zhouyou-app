import type { CSSProperties } from 'react';
import { APPEARANCE_STYLES, applyAppearanceStyle, applyThemeMode, useAppearanceStyle, useThemeMode } from '../theme';
import { useI18n } from '../i18n';

/** 风格工坊：每张样卡真实还原对应风格的底纹、描边、圆角、阴影与装饰气质。 */
export default function AppearanceSettings() {
  const selected = useAppearanceStyle();
  const mode = useThemeMode();
  const { isEn, t } = useI18n();

  const modes = [
    ['system', t('跟随系统', 'System')],
    ['light', t('浅色', 'Light')],
    ['dark', t('深色', 'Dark')],
  ] as const;

  return (
    <section id="settings-appearance" className="card appearance-settings" aria-labelledby="appearance-heading">
      <div className="card-heading">
        <div>
          <h2 id="appearance-heading">{t('外观风格工坊', 'Appearance & Themes')}</h2>
          <p className="muted">
            {t(
              '不只是换颜色——底纹材质、卡片边框、贴纸胶带与交互手感都会一起变身。',
              'More than just colors—paper texture, card borders, stickers, and motion transform together.',
            )}
          </p>
        </div>
        <span className="appearance-autosave-pill">{t('即时生效 · 自动保存', 'Instant · Auto-saved')}</span>
      </div>

      <div className="appearance-grid" role="group" aria-label={t('外观风格', 'Appearance style')}>
        {APPEARANCE_STYLES.map((style) => (
          <button
            type="button"
            key={style.id}
            className={`appearance-option ${selected === style.id ? 'selected' : ''}`}
            aria-pressed={selected === style.id}
            onClick={() => applyAppearanceStyle(style.id)}
            style={{
              '--sample-paper': style.colors[0],
              '--sample-accent': style.colors[1],
              '--sample-soft': style.colors[2],
              '--sample-pop': style.colors[3],
            } as CSSProperties}
          >
            <span className={`appearance-preview sample-${style.id}`} aria-hidden="true">
              <span className="sample-sidebar">
                <i />
                <i />
                <i />
              </span>
              <span className="sample-content">
                <span className="sample-header-row">
                  <i className="sample-title" />
                  <i className="sample-chip" />
                </span>
                <span className="sample-photo">
                  <i className="sample-tape" />
                  <i className="sample-sticker" />
                </span>
                <span className="sample-blocks">
                  <i />
                  <i />
                  <i />
                </span>
              </span>
            </span>

            <span className="appearance-name">
              <strong>{isEn ? style.nameEn : style.name}</strong>
              <em className="appearance-tag">{isEn ? style.badgeEn : style.badge}</em>
              {selected === style.id && <span className="appearance-check" aria-hidden="true">✓</span>}
            </span>
            <small>{isEn ? style.descriptionEn : style.description}</small>
          </button>
        ))}
      </div>

      <div className="appearance-mode">
        <div>
          <strong>{t('明暗模式', 'Color Mode')}</strong>
          <small>{t('五种风格均已独立适配浅色与深色画面', 'All five styles are crafted for both light and dark modes')}</small>
        </div>
        <div role="group" aria-label={t('明暗模式', 'Color mode')}>
          {modes.map(([value, label]) => (
            <button type="button" key={value} aria-pressed={mode === value} onClick={() => applyThemeMode(value)}>
              {label}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
