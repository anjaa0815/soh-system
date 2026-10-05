import React from 'react'

import { colors } from '@open-condo/ui/colors'


const SVG_PROPS = { viewBox: '0 0 346 240', width: '100%', role: 'img', 'aria-hidden': true } as const

const Building: React.FC<{ x: number, floors: number, color: string }> = ({ x, floors, color }) => {
    const height = floors * 22 + 14
    const top = 220 - height
    return (
        <g>
            <rect x={x} y={top} width={70} height={height} rx={6} fill={color} />
            {Array.from({ length: floors }).map((_, floor) => (
                [0, 1, 2].map(col => (
                    <rect key={`${floor}-${col}`} x={x + 10 + col * 19} y={top + 10 + floor * 22} width={12} height={12} rx={2} fill={colors.white} opacity={0.85} />
                ))
            ))}
        </g>
    )
}

const Card: React.FC<React.PropsWithChildren<{ x: number, y: number, w: number, h: number }>> = ({ x, y, w, h, children }) => (
    <g>
        <rect x={x + 3} y={y + 5} width={w} height={h} rx={14} fill={colors.black} opacity={0.06} />
        <rect x={x} y={y} width={w} height={h} rx={14} fill={colors.white} />
        {children}
    </g>
)

const Line: React.FC<{ x: number, y: number, w: number, color?: string }> = ({ x, y, w, color = colors.gray[3] }) => (
    <rect x={x} y={y} width={w} height={8} rx={4} fill={color} />
)

export const TicketsIllustration: React.FC = () => (
    <svg {...SVG_PROPS}>
        <Building x={30} floors={7} color={colors.green[5]} />
        <Card x={120} y={30} w={200} h={56}>
            <circle cx={146} cy={58} r={12} fill={colors.orange[5]} />
            <Line x={168} y={46} w={120} color={colors.gray[5]} />
            <Line x={168} y={62} w={80} />
        </Card>
        <Card x={140} y={100} w={190} h={56}>
            <circle cx={166} cy={128} r={12} fill={colors.blue[5]} />
            <Line x={188} y={116} w={110} color={colors.gray[5]} />
            <Line x={188} y={132} w={70} />
        </Card>
        <Card x={120} y={170} w={200} h={56}>
            <circle cx={146} cy={198} r={12} fill={colors.green[5]} />
            <path d='M140 198 l5 5 l9 -10' stroke={colors.white} strokeWidth={3} fill='none' strokeLinecap='round' strokeLinejoin='round' />
            <Line x={168} y={186} w={120} color={colors.gray[5]} />
            <Line x={168} y={202} w={90} />
        </Card>
    </svg>
)

export const PaymentsIllustration: React.FC = () => (
    <svg {...SVG_PROPS}>
        <Card x={40} y={20} w={170} h={200}>
            <Line x={62} y={44} w={90} color={colors.gray[5]} />
            <Line x={62} y={64} w={126} />
            <Line x={62} y={84} w={110} />
            <Line x={62} y={104} w={126} />
            <rect x={62} y={134} width={126} height={1.5} fill={colors.gray[3]} />
            <Line x={62} y={150} w={50} color={colors.gray[5]} />
            <Line x={138} y={150} w={50} color={colors.green[5]} />
            <rect x={62} y={178} width={126} height={26} rx={13} fill={colors.green[5]} />
        </Card>
        <Card x={196} y={70} w={120} h={120}>
            {[0, 1, 2, 3, 4].map(row => [0, 1, 2, 3, 4].map(col => (
                (row + col) % 2 === 0 || row === 0 || col === 0
                    ? <rect key={`${row}-${col}`} x={214 + col * 17} y={88 + row * 17} width={14} height={14} rx={2} fill={colors.black} />
                    : null
            )))}
        </Card>
    </svg>
)

export const ResidentsIllustration: React.FC = () => (
    <svg {...SVG_PROPS}>
        <Building x={40} floors={5} color={colors.blue[5]} />
        <Building x={120} floors={8} color={colors.green[5]} />
        <Building x={200} floors={6} color={colors.purple[5]} />
        <Card x={230} y={20} w={96} h={72}>
            <circle cx={278} cy={46} r={14} fill={colors.orange[5]} />
            <Line x={254} y={70} w={48} color={colors.gray[5]} />
        </Card>
        <rect x={20} y={220} width={306} height={6} rx={3} fill={colors.gray[3]} />
    </svg>
)

export const NewsIllustration: React.FC = () => (
    <svg {...SVG_PROPS}>
        <rect x={110} y={20} width={126} height={210} rx={20} fill={colors.black} />
        <rect x={118} y={30} width={110} height={190} rx={14} fill={colors.white} />
        <Line x={130} y={46} w={60} color={colors.gray[5]} />
        <rect x={130} y={66} width={86} height={50} rx={8} fill={colors.blue[1]} />
        <Line x={130} y={128} w={86} />
        <Line x={130} y={144} w={70} />
        <rect x={130} y={170} width={86} height={50} rx={8} fill={colors.green[1]} />
        <Card x={196} y={40} w={130} h={54}>
            <circle cx={222} cy={67} r={12} fill={colors.red[5]} />
            <Line x={242} y={56} w={66} color={colors.gray[5]} />
            <Line x={242} y={72} w={48} />
        </Card>
        <path d='M46 120 l40 -20 v60 l-40 -20 z' fill={colors.orange[5]} />
        <rect x={30} y={112} width={18} height={24} rx={4} fill={colors.orange[5]} />
        <path d='M94 110 q10 20 0 40' stroke={colors.orange[5]} strokeWidth={4} fill='none' strokeLinecap='round' />
    </svg>
)
