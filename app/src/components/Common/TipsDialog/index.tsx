import { RootStore } from "@/store";
import { observer } from "mobx-react-lite";
import { useTranslation } from "react-i18next";
import { Button } from "@heroui/react";
import { DialogStandaloneStore } from "@/store/module/DialogStandalone";

const TipsDialog = observer(({ content, onConfirm, onCancel, buttonSlot }: any) => {
  const { t } = useTranslation()
  return <div className='flex flex-col'>
    <div className='flex gap-4 items-center '>
      <div className="ml-4">{content}</div>
    </div>
    <div className='flex my-4 gap-4'>
      {
        buttonSlot ? buttonSlot : <>
          <Button className="ml-auto" color='default'
            onPress={e => {
              RootStore.Get(DialogStandaloneStore).close()
              onCancel?.()
            }}>{t('cancel')}</Button>
          <Button color='danger' onPress={async e => {
            onConfirm?.()
          }}>{t('confrim')}</Button>
        </>
      }
    </div>
  </div>
})

export const showTipsDialog = async (props: { size?: 'sm' | 'md' | 'lg' | 'xl', title: string, content: string, onConfirm?, onCancel?: any, buttonSlot?: React.ReactNode }) => {
  RootStore.Get(DialogStandaloneStore).setData({
    isOpen: true,
    onlyContent: false,
    size: props.size || 'md',
    title: props.title,
    content: <TipsDialog {...props} />
  })
}
