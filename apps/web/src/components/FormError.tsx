import { useLayoutEffect, useRef, useState } from 'preact/hooks'

export interface FormErrorState {
  message: string | undefined
  attempt: number
}

export const useFormError = () => {
  const [error, setState] = useState<FormErrorState>({ message: undefined, attempt: 0 })

  const setError = (message: string | undefined) => {
    setState((previous) => ({ message, attempt: previous.attempt + 1 }))
  }

  return [error, setError] as const
}

export const FormError = ({ error }: { error: FormErrorState }) => {
  const ref = useRef<HTMLParagraphElement | null>(null)

  useLayoutEffect(() => {
    if (error.message !== undefined) ref.current?.focus()
  }, [error.attempt, error.message])

  if (error.message === undefined) return null

  return (
    <p class="form-error" role="alert" tabIndex={-1} ref={ref}>
      {error.message}
    </p>
  )
}
