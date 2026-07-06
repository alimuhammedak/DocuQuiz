import { useEffect, useState } from 'react'

/** Blob'u objectURL yaşam döngüsüyle birlikte gösterir. */
export default function BlobImg({ blob, alt }: { blob: Blob; alt: string }) {
  const [url, setUrl] = useState<string>()
  useEffect(() => {
    const u = URL.createObjectURL(blob)
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [blob])
  if (!url) return null
  return <img className="blob-img" src={url} alt={alt} />
}
