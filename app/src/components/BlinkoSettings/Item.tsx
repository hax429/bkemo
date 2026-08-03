import { Icon } from '@/components/Common/Iconify/icons';
import { Tooltip } from "@heroui/react";
import { observer } from "mobx-react-lite";

type IProps = {
  leftContent?: any
  rightContent?: any
  type?: 'row' | 'col'
  hidden?: boolean
  className?: string
}


export const Item = observer(({ leftContent, rightContent, type = 'row', hidden = false, className }: IProps) => {
  if (hidden) return null
  if (type == 'col') {
    return <div className={`flex flex-col py-2 ${className}`}>
      <div className="font-semibold">{leftContent}</div>
      <div className="mt-2 w-full">{rightContent}</div>
    </div>
  } else {
    return <div className={`flex flex-row items-center py-2 ${className}`}>
      {!!leftContent && <div className={rightContent ? "font-semibold" : 'w-full'}>{leftContent}</div>}
      {!!rightContent && <div className="ml-auto">{rightContent}</div>}
    </div>
  }
})


export const ItemWithTooltip = observer(({ content, toolTipContent }: { content: any, toolTipContent: any }) => {
  return  <Tooltip content={<div className="max-w-[300px] flex flex-col gap-2 p-2">
      {toolTipContent}
    </div>}>
      <div className="flex items-center gap-2">
        {content}
        <Icon icon="proicons:info" width="18" height="18" />
      </div>
    </Tooltip>
})