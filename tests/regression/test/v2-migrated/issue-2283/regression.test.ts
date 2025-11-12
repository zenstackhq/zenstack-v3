import { createPolicyTestClient } from '@zenstackhq/testtools';
import path from 'path';
import { describe, expect, it } from 'vitest';

describe('Regression for issue 2283', () => {
    it('regression', async () => {
        const db: any = await createPolicyTestClient(
            `
// Base models
type Base {
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt()
}

type BaseWithCuid with Base {
  id String @id @default(cuid())
}

type Publishable {
  published Boolean @default(false)
}

// Media models
model Image with BaseWithCuid {
  storageRef      String
  displayName     String?
  width           Int
  height          Int
  size            BigInt

  // Relations
  userProfiles        UserProfile[]
  labProfiles         LabProfile[]
  contents            Content[]
  modules             Module[]
  classes             Class[]

  @@allow('all', true)
}

model Video with BaseWithCuid {
  storageRef      String
  displayName     String?
  durationMillis  Int
  width           Int?
  height          Int?
  size            BigInt

  // Relations
  previewForContent Content[]
  previewForModule  Module[]
  classes           Class[]

  @@allow('all', true)
}

// User models
model User with Base {
  id          String @id @default(uuid())
  email       String @unique
  displayName String?

  profile     UserProfile?
  labs        UserLabJoin[]
  ownedLabs   Lab[]

  @@allow('all', true)
}

model UserProfile with BaseWithCuid {
  user           User    @relation(fields: [userId], references: [id], onDelete: Cascade)
  userId         String  @unique
  bio            String?
  instagram      String?
  profilePhoto   Image?  @relation(fields: [profilePhotoId], references: [id], onDelete: SetNull)
  profilePhotoId String?

  @@allow('all', true)
}

// Lab models
model Lab with BaseWithCuid, Publishable {
  name                 String
  profile              LabProfile?
  owners               User[]
  community            UserLabJoin[]
  roles                Role[]
  privileges           Privilege[]
  content              Content[]
  permissions          LabPermission[]

  @@allow('create', auth() != null)
  @@allow('read', owners?[id == auth().id] || published) 
  @@allow('update', 
    owners?[id == auth().id] 
    || 
    community?[
      userLabRoles?[
        userId == auth().id
        && 
        role.privileges?[
          privilege.labPermissions?[
            type == "ALLOW_ADMINISTRATION"
          ]
        ]
      ]
    ]
  )
  @@allow('delete', owners?[id == auth().id])
}

model LabProfile with BaseWithCuid {
  lab            Lab     @relation(fields: [labId], references: [id], onDelete: Cascade)
  labId          String  @unique
  bio            String?
  instagram      String?
  profilePhoto   Image?  @relation(fields: [profilePhotoId], references: [id], onDelete: SetNull)
  profilePhotoId String?
  slug           String? @unique

  @@allow('read', check(lab, "read"))
  @@allow('create', lab.owners?[id == auth().id])
  @@allow('update', check(lab, "update"))
  @@allow('delete', check(lab, "delete"))
}

// User-Lab relationship
model UserLabJoin with Base {
  user             User          @relation(fields: [userId], references: [id], onDelete: Cascade)
  userId           String
  lab              Lab           @relation(fields: [labId], references: [id], onDelete: Restrict)
  labId            String
  userLabRoles     UserLabRole[]

  @@id(name: "userLabJoinId", [userId, labId])

  @@allow('create', auth().id == userId)
  @@allow('update', auth().id == userId)
  @@allow('read', true)
  @@allow('delete', auth().id == userId)
}

// Role and Permission models
model Role with BaseWithCuid {
  name              String
  shortDescription  String?
  longDescription   String?
  lab               Lab                 @relation(fields: [labId], references: [id], onDelete: Cascade)
  labId             String
  userLabRoles      UserLabRole[]
  privileges        RolePrivilegeJoin[]
  public            Boolean             @default(false)
  priority          Int                 @default(0)
  isTeamRole        Boolean             @default(false)

  @@unique([labId, id])
  @@unique([name, labId])

  @@allow('read', 
    auth().id != null 
    &&
    (
      userLabRoles?[userId == auth().id]
      || 
      auth().labs?[
        userLabRoles?[
          role.privileges?[
            privilege.labPermissions?[type == "ALLOW_ADMINISTRATION"] 
          ]
          &&
          labId == this.labId
        ]
      ]
      || 
      lab.owners?[id == auth().id]
    )
  )
  @@allow('create', 
    auth().id != null 
    && 
    (
      lab.owners?[id == auth().id]
      || 
      auth().labs?[
        userLabRoles?[
          role.privileges?[
            privilege.labPermissions?[type == "ALLOW_ADMINISTRATION"] 
            && 
            privilege.labId == this.labId
          ]
        ]
      ]
    )
  )
  @@allow('update', 
    auth().id != null 
    && 
    (
      lab.owners?[id == auth().id]
      || 
      auth().labs?[
        userLabRoles?[
          role.privileges?[
            privilege.labPermissions?[type == "ALLOW_ADMINISTRATION"] 
            && 
            privilege.labId == this.labId
          ]
        ]
      ]
    )
  )
  @@allow('delete', 
    auth().id != null 
    && 
    (
      lab.owners?[id == auth().id]
      || 
      auth().labs?[
        userLabRoles?[
          role.privileges?[
            privilege.labPermissions?[type == "ALLOW_ADMINISTRATION"] 
            && 
            privilege.labId == this.labId
          ]
        ]
      ]
    )
  )
}

model UserLabRole with Base {
  userLabJoin   UserLabJoin @relation(fields: [userId, labId], references: [userId, labId], onDelete: Cascade)
  userId        String
  labId         String
  role          Role        @relation(fields: [labId, roleId], references: [labId, id], onDelete: Cascade)
  roleId        String
  expiresAt     DateTime?

  @@id(name: "userLabRoleId", [userId, labId, roleId])

  @@allow('read', auth().id != null)
  @@allow('create', 
    auth().id != null 
    &&
    (
      userLabJoin.lab.owners?[id == auth().id]
      || 
      auth().labs?[
        userLabRoles?[
          role.labId == labId
          &&
          role.privileges?[
            privilege.labPermissions?[type == "ALLOW_ADMINISTRATION"]
          ]
        ]
      ]
    )
  )
  @@allow('update', 
    auth().id != null 
    &&
    (
      userLabJoin.lab.owners?[id == auth().id]
      || 
      auth().labs?[
        userLabRoles?[
          role.labId == labId
          &&
          role.privileges?[
            privilege.labPermissions?[type == "ALLOW_ADMINISTRATION"]
          ]
        ]
      ]
    )
  )
  @@allow('delete', 
    auth().id != null 
    &&
    (
      userLabJoin.lab.owners?[id == auth().id]
      || 
      auth().labs?[
        userLabRoles?[
          role.labId == labId
          &&
          role.privileges?[
            privilege.labPermissions?[type == "ALLOW_ADMINISTRATION"]
          ]
        ]
      ]
    )
  )
}

model Privilege with BaseWithCuid {
  name               String
  longDescription    String?
  shortDescription   String
  lab                Lab                 @relation(fields: [labId], references: [id], onDelete: Cascade)
  labId              String
  roles              RolePrivilegeJoin[]
  labPermissions     LabPermission[]
  public             Boolean             @default(false)

  @@unique([name, labId])

  @@allow('read', auth().id != null)
  @@allow('create', 
    auth().id != null 
    && 
    (
      lab.owners?[id == auth().id]
      || 
      auth().labs?[
        userLabRoles?[
          role.labId == labId
          &&
          role.privileges?[
            privilege.labPermissions?[type == "ALLOW_ADMINISTRATION"]
          ]
        ]
      ]
    )
  )
  @@allow('update', 
    auth().id != null 
    && 
    (
      lab.owners?[id == auth().id]
      || 
      auth().labs?[
        userLabRoles?[
          role.labId == labId
          &&
          role.privileges?[
            privilege.labPermissions?[type == "ALLOW_ADMINISTRATION"]
          ]
        ]
      ]
    )
  )
  @@allow('delete', 
    auth().id != null 
    && 
    (
      lab.owners?[id == auth().id]
      || 
      auth().labs?[
        userLabRoles?[
          role.labId == labId
          &&
          role.privileges?[
            privilege.labPermissions?[type == "ALLOW_ADMINISTRATION"]
          ]
        ]
      ]
    )
  )
}

model LabPermission with BaseWithCuid {
  name       String
  lab        Lab              @relation(fields: [labId], references: [id], onDelete: Cascade)
  labId      String
  privileges Privilege[]
  type       String

  @@unique([name, labId])

  @@allow('read', auth().id != null)
  @@allow('create', 
    auth().id != null 
    &&
    (
      lab.owners?[id == auth().id]
      || 
      auth().labs?[
        userLabRoles?[
          role.labId == this.labId
          &&
          role.privileges?[
            privilege.labPermissions?[type == "ALLOW_ADMINISTRATION"]
          ]
        ]
      ]
    )
  )
  @@allow('update', 
    auth().id != null 
    &&
    (
      lab.owners?[id == auth().id]
      || 
      auth().labs?[
        userLabRoles?[
          role.labId == this.labId
          &&
          role.privileges?[
            privilege.labPermissions?[type == "ALLOW_ADMINISTRATION"]
          ]
        ]
      ]
    )
  ) 
  @@allow('delete', 
    auth().id != null 
    &&
    (
      lab.owners?[id == auth().id]
      || 
      auth().labs?[
        userLabRoles?[
          role.labId == this.labId
          &&
          role.privileges?[
            privilege.labPermissions?[type == "ALLOW_ADMINISTRATION"]
          ]
        ]
      ]
    )
  ) 
}

model RolePrivilegeJoin with Base {
  role        Role      @relation(fields: [roleId], references: [id], onDelete: Cascade)
  roleId      String
  privilege   Privilege @relation(fields: [privilegeId], references: [id], onDelete: Cascade)
  privilegeId String
  order       Int?

  @@id(name: "rolePrivilegeJoinId", [roleId, privilegeId])

  @@allow('read', auth().id != null)
  @@allow('create', 
    auth().id != null 
    && 
    (
      role.lab.owners?[id == auth().id]
      || 
      auth().labs?[
        userLabRoles?[
          role.privileges?[
            privilege.labPermissions?[type == "ALLOW_ADMINISTRATION"]
          ]
        ]
      ]
    )
  )
  @@allow('update', 
    auth().id != null 
    && 
    (
      role.lab.owners?[id == auth().id]
      || 
      auth().labs?[
        userLabRoles?[
          role.privileges?[
            privilege.labPermissions?[type == "ALLOW_ADMINISTRATION"]
          ]
        ]
      ]
    )
  )
  @@allow('delete', 
    auth().id != null 
    && 
    (
      role.lab.owners?[id == auth().id]
      || 
      auth().labs?[
        userLabRoles?[
          role.privileges?[
            privilege.labPermissions?[type == "ALLOW_ADMINISTRATION"]
          ]
        ]
      ]
    )
  )
}

// Content models
model Content with BaseWithCuid {
  lab              Lab     @relation(fields: [labId], references: [id], onDelete: Cascade)
  labId            String
  name             String
  shortDescription String?
  longDescription  String?
  thumbnail        Image?             @relation(fields: [thumbnailId], references: [id])
  thumbnailId      String?
  modules          Module[]
  published        Boolean
  previewVideo     Video?             @relation(fields: [previewVideoId], references: [id])
  previewVideoId   String?
  order            Int

  @@unique([labId, order])

  @@allow('read', 
    lab.owners?[id == auth().id]
    ||
    lab.community?[
        userId == auth().id 
        &&
        userLabRoles?[
          labId == this.labId
          &&
          role.privileges?[
            privilege.labPermissions?[
              type in ["ALLOW_ADMINISTRATION"]
            ]
          ]
        ]
      ]
    ||
    published == true
  )
  @@allow('create', 
    lab.owners?[id == auth().id]
    ||
    lab.community?[
      userId == auth().id 
      &&
      userLabRoles?[
        labId == this.labId
        &&
        role.privileges?[
          privilege.labPermissions?[
            type in ["ALLOW_ADMINISTRATION"]
          ]
        ]
      ]
    ]
  )
  @@allow('update', 
    lab.owners?[id == auth().id]
    ||
    lab.community?[
      userId == auth().id 
      &&
      userLabRoles?[
        labId == this.labId
        &&
        role.privileges?[
          privilege.labPermissions?[
            type in ["ALLOW_ADMINISTRATION"]
          ]
        ]
      ]
    ]
  )
  @@allow('delete', 
    lab.owners?[id == auth().id]
    ||
    lab.community?[
      userId == auth().id 
      &&
      userLabRoles?[
        labId == this.labId
        &&
        role.privileges?[
          privilege.labPermissions?[
            type in ["ALLOW_ADMINISTRATION"]
          ]
        ]
      ]
    ]
  )
}

model Module with BaseWithCuid {
  name             String
  shortDescription String?
  longDescription  String?
  thumbnail        Image?  @relation(fields: [thumbnailId], references: [id])
  thumbnailId      String?
  content          Content @relation(fields: [contentId], references: [id], onDelete: Restrict)
  contentId        String
  classes          Class[]
  order            Int
  published        Boolean
  category         String?
  previewVideo     Video?  @relation(fields: [previewVideoId], references: [id])
  previewVideoId   String?

  @@unique([order, category, contentId])

  @@allow('read', 
    content.lab.owners?[id == auth().id]
    ||
    content.lab.permissions?[
        privileges?[
          roles?[
            role.userLabRoles?[
              userId == auth().id
            ]
          ]
          &&
          labPermissions?[
            type in ["ALLOW_ADMINISTRATION"]
          ]
        ]
      ]
    ||
    (
      check(content, 'read')
      &&
      published == true
    )
  ) 
  @@allow('create', check(content, 'create'))
  @@allow('update', check(content, 'update'))
  @@allow('delete', check(content, 'delete'))
}

model Class with BaseWithCuid {
  name              String
  shortDescription  String?
  longDescription   String?
  thumbnail         Image?              @relation(fields: [thumbnailId], references: [id])
  thumbnailId       String?
  module            Module              @relation(fields: [moduleId], references: [id], onDelete: Restrict)
  moduleId          String
  order             Int
  published         Boolean
  video             Video?              @relation(fields: [videoId], references: [id])
  videoId           String?
  category          String?

  @@unique([order, category, moduleId])

  @@allow('read', check(module, 'read'))
  @@allow('create', check(module, 'create'))
  @@allow('update', check(module, 'update'))
  @@allow('delete', check(module, 'delete'))
}
`,
            {
                provider: 'sqlite',
                dbFile: path.join(__dirname, 'dev.db'),
            },
        );

        const r = await db.labProfile.findUnique({
            where: {
                slug: 'test-lab-slug',
                lab: {
                    published: true,
                },
            },
            select: {
                lab: {
                    select: {
                        id: true,
                        name: true,
                        content: {
                            where: {
                                published: true,
                            },
                            select: {
                                id: true,
                                name: true,
                                modules: {
                                    select: {
                                        id: true,
                                        name: true,
                                        classes: {
                                            select: {
                                                id: true,
                                                name: true,
                                            },
                                        },
                                    },
                                },
                            },
                        },
                    },
                },
            },
        });

        expect(r).toMatchObject({
            lab: expect.objectContaining({
                name: 'Test Lab',
                content: [
                    expect.objectContaining({
                        name: 'Test Course',
                        modules: [
                            expect.objectContaining({
                                name: 'Test Module',
                                classes: [
                                    expect.objectContaining({
                                        name: 'Test Class',
                                    }),
                                ],
                            }),
                        ],
                    }),
                ],
            }),
        });
        expect(r.lab.content[0].modules[0].classes[0].module).toBeUndefined();
    });
});
