import { xiaohongshuSearchUrl } from '../planner-xhs';
import { useI18n } from '../i18n';
import { TravelIcon } from './TravelArt';

/** 每座城市独立搜索，既可放在单城市手账，也可放在多城市行程总览。 */
export default function CityGuideLinks({ cities }: { cities: readonly string[] }) {
  const { t } = useI18n();
  const cityNames = [...new Set(cities.map((city) => city.trim()).filter(Boolean))];
  if (!cityNames.length) return null;

  const guideTopics = [
    { label: t('游玩攻略', 'Travel Guide'), query: '游玩攻略', icon: 'mountain', kind: 'sight' },
    { label: t('美食攻略', 'Food Guide'), query: '美食攻略', icon: 'food', kind: 'food' },
  ] as const;

  return (
    <div className="city-guide-links" role="group" aria-label={t('小红书城市攻略', 'Xiaohongshu City Guides')}>
      {cityNames.map((city) => (
        <div className="city-guide-group" key={city} role="group" aria-label={t(`${city}攻略`, `${city} guides`)}>
          <span>{city}</span>
          {guideTopics.map(({ label, query, icon, kind }) => (
            <a className={`city-guide-action city-guide-${kind}`} key={kind}
              href={xiaohongshuSearchUrl(`${city} ${query}`)} target="_blank" rel="noopener noreferrer"
              aria-label={`${city} ${label}`}>
              <TravelIcon name={icon} />
              {label}
              <span aria-hidden="true">↗</span>
            </a>
          ))}
        </div>
      ))}
    </div>
  );
}
