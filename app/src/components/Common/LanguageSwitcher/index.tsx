import { RootStore } from '@/store';
import { BaseStore } from '@/store/baseStore';
import { useTranslation } from 'react-i18next';
import { BkemoSelect } from '../BkemoSelect';

interface LanguageSwitcherProps {
  value?: string;
  onChange?: (value: string) => void;
}

const LanguageSwitcher = ({ value, onChange }: LanguageSwitcherProps = {}) => {
  const baseStore = RootStore.Get(BaseStore);
  const { i18n } = useTranslation();
  
  function onSelectChange(nextLocale: string) {
    baseStore.changeLanugage(i18n, nextLocale);
    onChange?.(nextLocale);
  }

  const currentLocale = value || baseStore.locale.value;
  
  const selectOptions = baseStore.locales.map(locale => ({
    v: locale.value,
    label: locale.label
  }));

  return (
    <BkemoSelect
      value={currentLocale}
      options={selectOptions}
      onChange={onSelectChange}
    />
  );
};

export default LanguageSwitcher;
