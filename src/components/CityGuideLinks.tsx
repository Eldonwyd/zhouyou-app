import { xiaohongshuSearchUrl } from '../planner-xhs';
import { TravelIcon } from './TravelArt';

const GUIDE_TOPICS = [
  { label: '游玩攻略', icon: 'mountain', kind: 'sight' },
  { label: '美食攻略', icon: 'food', kind: 'food' },
] as const;

/** 每座城市独立搜索，既可放在单城市手账，也可放在多城市行程总览。 */
export default function CityGuideLinks({ cities }: { cities: readonly string[] }) {
  const cityNames = [...new Set(cities.map((city) => city.trim()).filter(Boolean))];
  if (!cityNames.length) return null;

  return (
    <div className="city-guide-links" role="group" aria-label="小红书城市攻略">
      {cityNames.map((city) => (
        <div className="city-guide-group" key={city} role="group" aria-label={`${city}攻略`}>
          <span>{city}</span>
          {GUIDE_TOPICS.map(({ label, icon, kind }) => (
            <a className={`city-guide-action city-guide-${kind}`} key={kind}
              href={xiaohongshuSearchUrl(`${city} ${label}`)} target="_blank" rel="noopener noreferrer"
              aria-label={`${city}${label}`}>
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
